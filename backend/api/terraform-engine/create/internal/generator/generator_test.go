package generator

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Alberta2514640/clutter/backend/api/generic"
	"github.com/Alberta2514640/clutter/backend/api/terraform-engine/create/internal"
)

// refusingGenerator reads its templates from a local server that refuses every
// request, the way S3 does for a role without access. No test here reaches AWS.
func refusingGenerator(t *testing.T) *TerraformGenerator {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("AWS_ENDPOINT_URL", server.URL)
	t.Setenv("AWS_ACCESS_KEY_ID", "test-only")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "test-only")
	t.Setenv("AWS_EC2_METADATA_DISABLED", "true")

	gen, err := NewTerraformGenerator(context.Background(), "templates-bucket")
	if err != nil {
		t.Fatal(err)
	}
	return gen
}

func node(id, label string, variables map[string]any) generic.DiagramNode {
	return generic.DiagramNode{ID: id, Data: map[string]any{"label": label}, Variables: variables}
}

func TestATemplateFetchFailureIsMarkedAndItsCauseStaysOutOfTheSummary(t *testing.T) {
	gen := refusingGenerator(t)
	_, errs := gen.Generate(context.Background(), "diagram", generic.DiagramLayout{Nodes: []generic.DiagramNode{
		node("a", "S3", map[string]any{"resource_name": "uploads"}),
	}})
	if len(errs) != 1 || errs[0].ErrorType != internal.ErrorTypeTemplate {
		t.Fatalf("errors: %+v", errs)
	}
	// The cause is kept for the log.
	if !strings.Contains(errs[0].Message, "templates/aws/s3/main.tf.tmpl") {
		t.Fatalf("message: %q", errs[0].Message)
	}
	summary := internal.SummarizeErrors(errs)
	for _, leak := range []string{"templates/aws", "templates-bucket", "AccessDenied", "S3", "api error"} {
		if strings.Contains(summary, leak) {
			t.Fatalf("%q reached the user: %q", leak, summary)
		}
	}
}

func TestAnErrorInTheDiagramKeepsItsRealMessage(t *testing.T) {
	gen := refusingGenerator(t)
	_, errs := gen.Generate(context.Background(), "diagram", generic.DiagramLayout{Nodes: []generic.DiagramNode{
		node("a", "Widget", nil),
		node("b", "S3", nil),
	}})
	if len(errs) != 2 {
		t.Fatalf("errors: %+v", errs)
	}
	summary := internal.SummarizeErrors(errs)
	want := "Widget: unknown resource type: Widget; S3: missing required variables: [resource_name]"
	if summary != want {
		t.Fatalf("got %q, want %q", summary, want)
	}
}
