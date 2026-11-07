package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Alberta2514640/clutter/backend/api/generic"
	"github.com/aws/aws-lambda-go/events"
)

func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(previous) })
	return &buf
}

func TestRecordFailureStopsAtAnEmptyDiagramID(t *testing.T) {
	// A bad connection string proves the guard: past it, the log line would be
	// about the database.
	t.Setenv("PSQL_CONNECTION_STRING", "postgres://127.0.0.1:1/none?connect_timeout=1")
	logged := captureLog(t)
	recordFailure(context.Background(), generic.DiagramRecord{ProjectID: "project"}, "failed")
	if !strings.Contains(logged.String(), "no diagram id") {
		t.Fatalf("log: %q", logged.String())
	}
}

func TestATemplateFailureIsLoggedWithItsCause(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>`))
	}))
	defer server.Close()
	t.Setenv("AWS_ENDPOINT_URL", server.URL)
	t.Setenv("AWS_ACCESS_KEY_ID", "test-only")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "test-only")
	t.Setenv("AWS_EC2_METADATA_DISABLED", "true")
	t.Setenv("TEMPLATE_BUCKET_NAME", "templates-bucket")
	logged := captureLog(t)

	body, err := json.Marshal(map[string]any{"record": map[string]any{
		"id": "diagram",
		"data": map[string]any{"nodes": []any{map[string]any{
			"id": "a", "data": map[string]any{"label": "S3", "variables": map[string]any{"resource_name": "uploads"}},
		}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	res, err := handler(context.Background(), events.APIGatewayProxyRequest{Body: string(body)})
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("status %d: %s", res.StatusCode, res.Body)
	}
	if !strings.Contains(logged.String(), "templates/aws/s3/main.tf.tmpl") {
		t.Fatalf("log: %q", logged.String())
	}
}
