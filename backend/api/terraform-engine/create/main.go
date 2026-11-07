package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/Alberta2514640/clutter/backend/api/generic"
	"github.com/Alberta2514640/clutter/backend/api/terraform-engine/create/internal"
	"github.com/Alberta2514640/clutter/backend/api/terraform-engine/create/internal/generator"
	"github.com/Alberta2514640/clutter/backend/api/terraform-engine/create/internal/generator/writer"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
)

// What the user reads when the generator cannot start. The cause stays in the
// response and the log.
const startFailureMessage = "The Terraform generator could not start. Save the diagram again to retry."

func main() {
	lambda.Start(handler)
}

func handler(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {

	// Parse the webhook payload
	var payload internal.SupabaseWebhookPayload
	if err := json.Unmarshal([]byte(request.Body), &payload); err != nil {
		return generic.Response(http.StatusBadRequest, generic.Json{
			"error":   "Invalid JSON payload",
			"details": err.Error(),
		})
	}

	// if !internal.HasDataChanged(payload.OldRecord, payload.Record) {
	// 	// No relevant changes, ignore
	// 	return generic.Response(http.StatusOK, generic.Json{
	// 		"message": "No relevant changes in diagram data, ignoring webhook",
	// 	})
	// }

	// Clean the nodes in the record (Remove irrelevant fields)
	payload.Record.Data.Nodes = internal.SanitizeNodes(payload.Record.Data.Nodes)

	// Initialize terraform generator with template bucket
	templateBucket := os.Getenv("TEMPLATE_BUCKET_NAME")
	gen, err := generator.NewTerraformGenerator(ctx, templateBucket)
	if err != nil {
		log.Printf("diagram %s: %v", payload.Record.ID, err)
		recordFailure(ctx, payload.Record, startFailureMessage)
		return generic.Response(http.StatusInternalServerError, generic.Json{
			"error":   "Failed to initialize terraform generator",
			"details": err.Error(),
		})
	}

	// Generate terraform from diagram
	terraform, errors := gen.Generate(ctx, payload.Record.ID, payload.Record.Data)

	if len(errors) > 0 {
		for _, generationError := range errors {
			if generationError.ErrorType == internal.ErrorTypeTemplate {
				log.Printf("diagram %s: %s", payload.Record.ID, generationError.Message)
			}
		}
		recordFailure(ctx, payload.Record, internal.SummarizeErrors(errors))
		return generic.Response(http.StatusBadRequest, generic.Json{
			"message": "Terraform generation completed with errors",
			"errors":  errors,
		})
	}

	projectID := payload.Record.ProjectID
	if projectID == "" {
		return generic.Response(http.StatusBadRequest, generic.Json{
			"message": "Missing project_id in webhook record",
		})
	}

	conn, err := generic.PsqlConnect()
	if err != nil {
		return generic.Response(http.StatusInternalServerError, generic.Json{
			"message": "failed to connect to database",
			"error":   err.Error(),
		})
	}
	defer conn.Close(ctx)

	orgID, err := generic.GetProjectOrganizationPSQL(ctx, conn, projectID)
	if err != nil {
		if authErr, ok := err.(*generic.AuthorizationError); ok {
			return generic.Response(authErr.StatusCode, generic.Json{
				"message": authErr.Message,
			})
		}
		return generic.Response(http.StatusInternalServerError, generic.Json{
			"message": "failed to fetch project organization",
			"error":   err.Error(),
		})
	}

	terraform.ProjectID = projectID
	terraform.OrgID = orgID

	// Upload to S3
	s3BucketName := os.Getenv("S3_BUCKET_NAME")
	tfWriter, err := writer.NewTerraformWriter(ctx, s3BucketName)
	if err != nil {
		return generic.Response(http.StatusInternalServerError, generic.Json{
			"error":   "Failed to initialize S3 writer",
			"details": err.Error(),
		})
	}

	if err := tfWriter.Publish(ctx, terraform, payload.Record.LatestUpdateAt); err != nil {
		return generic.Response(http.StatusInternalServerError, generic.Json{
			"error":   "Failed to upload terraform files",
			"details": err.Error(),
		})
	}

	// Return success response
	return generic.Response(http.StatusOK, generic.Json{
		"message":    "Terraform files generated successfully",
		"diagram_id": payload.Record.ID,
		"s3_path":    fmt.Sprintf("s3://%s/%s/%s/%s/", s3BucketName, orgID, projectID, payload.Record.ID),
	})
}

// recordFailure writes a failed status beside the diagram's files, so the
// editor can say why they did not change. It runs on the way to an error
// response and never changes that response: when it cannot write, the log is
// the only record.
func recordFailure(ctx context.Context, record generic.DiagramRecord, message string) {
	if record.ID == "" {
		log.Print("no diagram id, so the failed run has no status")
		return
	}
	if record.ProjectID == "" {
		log.Printf("diagram %s: no project id, so the failed run has no status", record.ID)
		return
	}
	conn, err := generic.PsqlConnect()
	if err != nil {
		log.Printf("diagram %s: no database connection, so the failed run has no status", record.ID)
		return
	}
	defer conn.Close(ctx)

	orgID, err := generic.GetProjectOrganizationPSQL(ctx, conn, record.ProjectID)
	if err != nil {
		log.Printf("diagram %s: no organization for the project, so the failed run has no status", record.ID)
		return
	}
	tfWriter, err := writer.NewTerraformWriter(ctx, os.Getenv("S3_BUCKET_NAME"))
	if err != nil {
		log.Printf("diagram %s: no S3 writer, so the failed run has no status", record.ID)
		return
	}
	if err := tfWriter.RecordFailure(ctx, orgID, record.ProjectID, record.ID, message, record.LatestUpdateAt); err != nil {
		log.Printf("diagram %s: %v", record.ID, err)
	}
}
