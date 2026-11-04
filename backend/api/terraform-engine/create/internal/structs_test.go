package internal

import (
	"strings"
	"testing"
)

func TestSummarizeErrors(t *testing.T) {
	got := SummarizeErrors([]GenerationError{
		{NodeLabel: "Widget", Message: "unknown resource"},
		{NodeLabel: "Widget", Message: "unknown resource"},
		{Message: "node has no label in data"},
	})
	want := "Widget: unknown resource; node has no label in data"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestSummarizeErrorsHidesTemplateFailures(t *testing.T) {
	cause := "failed to fetch template templates/aws/s3/main.tf.tmpl from S3: AccessDenied"
	got := SummarizeErrors([]GenerationError{
		{NodeLabel: "S3", ErrorType: ErrorTypeTemplate, Message: cause},
		{NodeLabel: "Lambda", ErrorType: ErrorTypeTemplate, Message: cause},
		{NodeLabel: "Widget", Message: "unknown resource"},
	})
	want := templateFailureMessage + "; Widget: unknown resource"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	if strings.Contains(got, "templates/aws") || strings.Contains(got, "AccessDenied") {
		t.Fatalf("the cause reached the user: %q", got)
	}
}
