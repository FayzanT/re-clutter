// Package terraformfiles owns the layout of a diagram's generated Terraform in
// the clutter bucket: the folder, the status file the generator writes beside
// the files, and the bounded read the terraform-engine/files Lambda serves.
//
// That folder also holds the runner's state (terraform.tfstate) and deploy logs.
// Only .tf files and the status file ever leave it through this package.
package terraformfiles

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

const (
	// StatusFile is written after every generation run, success or failure.
	StatusFile = "status.json"

	StateSuccess = "success"
	StateFailed  = "failed"

	// Lambda responses stop at 6 MB, and JSON escaping grows Terraform text.
	maxFiles       = 32
	maxFileBytes   = 1 << 20
	maxTotalBytes  = 4 << 20
	maxStatusBytes = 64 << 10
	maxErrorChars  = 2000
)

// Status is the content of status.json. Its JSON is also the status the
// frontend reads (GenerationStatus in lib/features/diagram/types.ts).
type Status struct {
	State string `json:"state"`
	// Error is empty on success. It is shown to the user as it stands, so it
	// holds what they can act on, never an infrastructure error.
	Error string `json:"error,omitempty"`
	// FinishedAt is when the run ended, in UTC.
	FinishedAt string `json:"finishedAt"`
	// DiagramUpdatedAt is the diagram's latest_update_at as the run saw it. It
	// tells a reader whether this run covers the newest save, with no clock
	// comparison between the database and the generator.
	DiagramUpdatedAt string `json:"diagramUpdatedAt,omitempty"`
	// FilesIncomplete means an upload stopped partway and no run has finished
	// one since, so the folder may hold some files from one run and some from
	// another, or be missing a file.
	FilesIncomplete bool `json:"filesIncomplete,omitempty"`
}

// NewStatus builds the status of a finished run. An empty errorMessage is a
// success.
func NewStatus(errorMessage string, diagramUpdatedAt *string, now time.Time) Status {
	status := Status{State: StateSuccess, FinishedAt: now.UTC().Format(time.RFC3339)}
	if errorMessage != "" {
		status.State = StateFailed
		status.Error = truncate(errorMessage, maxErrorChars)
	}
	if diagramUpdatedAt != nil {
		status.DiagramUpdatedAt = *diagramUpdatedAt
	}
	return status
}

func truncate(s string, limit int) string {
	runes := []rune(s)
	if len(runes) <= limit {
		return s
	}
	return string(runes[:limit]) + "..."
}

// Folder is the key prefix of one diagram's generated files.
func Folder(orgID, projectID, diagramID string) string {
	return fmt.Sprintf("%s/%s/%s/terraform/", orgID, projectID, diagramID)
}

// ObjectReader is the part of the S3 client that reading one object needs.
type ObjectReader interface {
	GetObject(ctx context.Context, params *s3.GetObjectInput, optFns ...func(*s3.Options)) (*s3.GetObjectOutput, error)
}

// Store is the part of the S3 client a read of the folder needs.
type Store interface {
	ObjectReader
	ListObjectsV2(ctx context.Context, params *s3.ListObjectsV2Input, optFns ...func(*s3.Options)) (*s3.ListObjectsV2Output, error)
}

// ErrTooLarge means the folder holds more than one response can carry.
var ErrTooLarge = errors.New("the generated Terraform is too large to show")

// Read returns the .tf files directly inside folder, by file name, and the
// status. The status is nil when none exists, which is also true of files
// generated before the status file existed.
func Read(ctx context.Context, store Store, bucket, folder string) (map[string]string, *Status, error) {
	listing, err := store.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
		Bucket:    aws.String(bucket),
		Prefix:    aws.String(folder),
		Delimiter: aws.String("/"),
	})
	if err != nil {
		return nil, nil, fmt.Errorf("list generated files: %w", err)
	}
	if aws.ToBool(listing.IsTruncated) {
		return nil, nil, ErrTooLarge
	}

	var tfNames []string
	hasStatus := false
	var total int64
	for _, object := range listing.Contents {
		name := strings.TrimPrefix(aws.ToString(object.Key), folder)
		if name == StatusFile {
			hasStatus = true
			continue
		}
		if strings.Contains(name, "/") || !strings.HasSuffix(name, ".tf") {
			continue
		}
		size := aws.ToInt64(object.Size)
		total += size
		if size > maxFileBytes || total > maxTotalBytes || len(tfNames) == maxFiles {
			return nil, nil, ErrTooLarge
		}
		tfNames = append(tfNames, name)
	}

	// The generator writes the files first and the status last. Reading in the
	// other order means a run that lands between the reads can only make the
	// status look older than the files, which the caller retries.
	var status *Status
	if hasStatus {
		status, err = ReadStatus(ctx, store, bucket, folder)
		if err != nil {
			return nil, nil, err
		}
	}

	files := make(map[string]string, len(tfNames))
	for _, name := range tfNames {
		raw, found, err := getObject(ctx, store, bucket, folder+name, maxFileBytes)
		if err != nil {
			return nil, nil, err
		}
		// A run can delete a file between the listing and this read.
		if found {
			files[name] = string(raw)
		}
	}
	return files, status, nil
}

// ReadStatus returns the folder's status, or nil when there is none or it
// cannot be understood. An unreadable status must not hide the files beside it.
func ReadStatus(ctx context.Context, store ObjectReader, bucket, folder string) (*Status, error) {
	raw, found, err := getObject(ctx, store, bucket, folder+StatusFile, maxStatusBytes)
	if err != nil || !found {
		return nil, err
	}
	var status Status
	if json.Unmarshal(raw, &status) != nil || status.State == "" {
		return nil, nil
	}
	return &status, nil
}

func getObject(ctx context.Context, store ObjectReader, bucket, key string, limit int64) ([]byte, bool, error) {
	out, err := store.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
	if err != nil {
		var missing *types.NoSuchKey
		if errors.As(err, &missing) {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("read generated file: %w", err)
	}
	defer out.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(out.Body, limit+1))
	if err != nil {
		return nil, false, fmt.Errorf("read generated file: %w", err)
	}
	if int64(len(raw)) > limit {
		return nil, false, ErrTooLarge
	}
	return raw, true, nil
}
