package internal

import (
	"strings"

	"github.com/Alberta2514640/clutter/backend/api/generic"
)

type SupabaseWebhookPayload struct {
	Type      string               `json:"type"`                 // INSERT, UPDATE, DELETE
	Table     string               `json:"table"`                // table name
	Schema    string               `json:"schema"`               // usually "public"
	Record    generic.DiagramRecord `json:"record"`              // the new/updated record
	OldRecord generic.DiagramRecord `json:"old_record,omitempty"` // for UPDATE
}

// ResourceType represents supported AWS resource types
type ResourceType string

const (
	ResourceTypeLambda     ResourceType = "Lambda"
	ResourceTypeDynamoDB   ResourceType = "DynamoDB"
	ResourceTypeS3         ResourceType = "S3"
	ResourceTypeAPIGateway ResourceType = "API Gateway"
	ResourceTypeEC2        ResourceType = "EC2"
)

// TerraformResource represents a parsed diagram node ready for TF generation
type TerraformResource struct {
	ID           string
	Name         string                 // Sanitized name for TF resource naming
	Type         ResourceType
	Variables    map[string]interface{}
	SourceNodeID string // Original node ID for edge mapping
}

// IAMRelationship represents a connection requiring IAM permissions
type IAMRelationship struct {
	SourceResource *TerraformResource
	TargetResource *TerraformResource
	EdgeID         string
	EdgeLabel      string
}

// GeneratedTerraform holds all generated TF content
type GeneratedTerraform struct {
	OrgID       string
	ProjectID   string
	DiagramID   string
	MainTF      string
	ResourcesTF string
	IAMTF       string
	VariablesTF string
	OutputsTF   string
}

// ErrorTypeTemplate marks a GenerationError caused by Clutter's own templates,
// not by the diagram. Its Message holds bucket paths and SDK errors.
const ErrorTypeTemplate = "template_error"

// templateFailureMessage is what the user reads in place of that Message.
const templateFailureMessage = "A Terraform template could not be used. This is a problem on our side, not in your diagram. Save the diagram again to retry."

// GenerationError provides detailed error information
type GenerationError struct {
	NodeID    string `json:"node_id"`
	NodeLabel string `json:"node_label"`
	ErrorType string `json:"error_type"` // "unknown_label", "missing_variable", "invalid_config", ErrorTypeTemplate
	Message   string `json:"message"`
}

// SummarizeErrors turns a run's errors into the one message the user reads.
func SummarizeErrors(errs []GenerationError) string {
	seen := make(map[string]bool, len(errs))
	lines := make([]string, 0, len(errs))
	for _, e := range errs {
		line := e.Message
		if e.ErrorType == ErrorTypeTemplate {
			line = templateFailureMessage
		} else if e.NodeLabel != "" {
			line = e.NodeLabel + ": " + e.Message
		}
		if !seen[line] {
			seen[line] = true
			lines = append(lines, line)
		}
	}
	return strings.Join(lines, "; ")
}

// ResourceGenerator interface for each resource type
type ResourceGenerator interface {
	Generate(node generic.DiagramNode, resourceName string) (string, error)
	ValidateVariables(variables map[string]interface{}) error
	GetRequiredVariables() []string
	GetOutputs(resourceName string) string
}
