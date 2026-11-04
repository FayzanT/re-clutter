package writer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/Alberta2514640/clutter/backend/api/generic/terraformfiles"
	"github.com/Alberta2514640/clutter/backend/api/terraform-engine/create/internal"
)

// uploadFailureMessage is what the user reads when an upload stops. The cause
// stays in the response and the log.
const uploadFailureMessage = "The generated files could not all be stored, so the stored files may be incomplete. Save the diagram again to retry."

// statusReserve is the time an upload leaves for the status write. S3 retries
// can run an upload to the Lambda's deadline, and a status written on an expired
// context never arrives, which would hide the very failure it must report.
const statusReserve = time.Second

// objectStore is the part of the S3 client the writer uses.
type objectStore interface {
	terraformfiles.ObjectReader
	PutObject(ctx context.Context, params *s3.PutObjectInput, optFns ...func(*s3.Options)) (*s3.PutObjectOutput, error)
	DeleteObject(ctx context.Context, params *s3.DeleteObjectInput, optFns ...func(*s3.Options)) (*s3.DeleteObjectOutput, error)
}

type TerraformWriter struct {
	s3Client   objectStore
	bucketName string
}

func NewTerraformWriter(ctx context.Context, bucketName string) (*TerraformWriter, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion("us-west-2"))
	if err != nil {
		return nil, err
	}

	return &TerraformWriter{
		s3Client:   s3.NewFromConfig(cfg),
		bucketName: bucketName,
	}, nil
}

// WriteToS3 uploads generated terraform files to S3
func (w *TerraformWriter) WriteToS3(ctx context.Context, tf *internal.GeneratedTerraform) error {
	// Combine all into main.tf: provider + resources + IAM
	mainContent := tf.MainTF
	if tf.ResourcesTF != "" {
		mainContent += "\n" + tf.ResourcesTF
	}
	if tf.IAMTF != "" {
		mainContent += "\n" + tf.IAMTF
	}

	files := map[string]string{
		"main.tf":    mainContent,
		"outputs.tf": tf.OutputsTF,
	}

	if tf.OrgID == "" || tf.ProjectID == "" || tf.DiagramID == "" {
		return fmt.Errorf("missing org/project/diagram id for s3 path (org=%q project=%q diagram=%q)", tf.OrgID, tf.ProjectID, tf.DiagramID)
	}

	for filename, content := range files {
		key := terraformfiles.Folder(tf.OrgID, tf.ProjectID, tf.DiagramID) + filename

		// A file with nothing in it must not leave the previous run's copy behind:
		// the runner would deploy it. Deleting a missing key succeeds in S3.
		if content == "" {
			_, err := w.s3Client.DeleteObject(ctx, &s3.DeleteObjectInput{
				Bucket: aws.String(w.bucketName),
				Key:    aws.String(key),
			})
			if err != nil {
				return fmt.Errorf("failed to delete stale %s: %w", filename, err)
			}
			continue
		}

		_, err := w.s3Client.PutObject(ctx, &s3.PutObjectInput{
			Bucket:               aws.String(w.bucketName),
			Key:                  aws.String(key),
			Body:                 bytes.NewReader([]byte(content)),
			ContentType:          aws.String("text/plain"),
			ServerSideEncryption: types.ServerSideEncryptionAes256,
		})
		if err != nil {
			return fmt.Errorf("failed to upload %s: %w", filename, err)
		}
	}

	return nil
}

// Publish uploads a run's files, then records how the run ended. WriteToS3 writes
// the files one at a time in no fixed order, so a failed upload can leave some
// new and some old, and the status says so. A status that cannot be written is
// only logged: it never changes the run's result, and a reader treats a missing
// or older status as not current.
func (w *TerraformWriter) Publish(ctx context.Context, tf *internal.GeneratedTerraform, diagramUpdatedAt *string) error {
	uploadCtx, cancel := reserveStatusTime(ctx)
	defer cancel()
	if err := w.WriteToS3(uploadCtx, tf); err != nil {
		log.Printf("diagram %s: %v", tf.DiagramID, err)
		failed :=terraformfiles.NewStatus(uploadFailureMessage, diagramUpdatedAt, time.Now())
		failed.FilesIncomplete = true
		if statusErr := w.WriteStatus(ctx, tf.OrgID, tf.ProjectID, tf.DiagramID, failed); statusErr != nil {
			log.Printf("diagram %s: %v", tf.DiagramID, statusErr)
		}
		return err
	}

	succeeded := terraformfiles.NewStatus("", diagramUpdatedAt, time.Now())
	if err := w.WriteStatus(ctx, tf.OrgID, tf.ProjectID, tf.DiagramID, succeeded); err != nil {
		log.Printf("diagram %s: %v", tf.DiagramID, err)
	}
	return nil
}

func reserveStatusTime(ctx context.Context) (context.Context, context.CancelFunc) {
	deadline, ok := ctx.Deadline()
	if !ok {
		return context.WithCancel(ctx)
	}
	return context.WithDeadline(ctx, deadline.Add(-statusReserve))
}

// RecordFailure records a run that stopped before it uploaded anything. Such a
// run leaves the files as they were, so files an earlier upload left incomplete
// stay marked that way. The earlier status is best effort: this Lambda has no
// s3:ListBucket, so S3 answers a first run's missing status with access denied.
func (w *TerraformWriter) RecordFailure(ctx context.Context, orgID, projectID, diagramID, message string, diagramUpdatedAt *string) error {
	status := terraformfiles.NewStatus(message, diagramUpdatedAt, time.Now())
	previous, err := terraformfiles.ReadStatus(ctx, w.s3Client, w.bucketName, terraformfiles.Folder(orgID, projectID, diagramID))
	status.FilesIncomplete = err == nil && previous != nil && previous.FilesIncomplete
	return w.WriteStatus(ctx, orgID, projectID, diagramID, status)
}

// WriteStatus records how a run ended, beside the generated files. It touches
// only the status file; what the files beside it hold is the status's to say.
func (w *TerraformWriter) WriteStatus(ctx context.Context, orgID, projectID, diagramID string, status terraformfiles.Status) error {
	if orgID == "" || projectID == "" || diagramID == "" {
		return fmt.Errorf("missing org/project/diagram id for status path (org=%q project=%q diagram=%q)", orgID, projectID, diagramID)
	}

	body, err := json.Marshal(status)
	if err != nil {
		return fmt.Errorf("failed to encode generation status: %w", err)
	}

	_, err = w.s3Client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:               aws.String(w.bucketName),
		Key:                  aws.String(terraformfiles.Folder(orgID, projectID, diagramID) + terraformfiles.StatusFile),
		Body:                 bytes.NewReader(body),
		ContentType:          aws.String("application/json"),
		ServerSideEncryption: types.ServerSideEncryptionAes256,
	})
	if err != nil {
		return fmt.Errorf("failed to upload generation status: %w", err)
	}

	return nil
}

// GenerateMainTF creates the provider configuration
func GenerateMainTF() string {
	return `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type        = string
}
`
}
