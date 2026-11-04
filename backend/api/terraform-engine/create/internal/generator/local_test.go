package generator

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Alberta2514640/clutter/backend/api/generic"
)

func localTemplates(t *testing.T) string {
	t.Helper()
	path, err := filepath.Abs("../../../../../infra/modules/s3/uploads")
	if err != nil {
		t.Fatal(err)
	}
	return path
}

func previewNode(id, label, name string) generic.DiagramNode {
	return generic.DiagramNode{ID: id, Data: map[string]any{
		"label": label, "variables": map[string]any{"resource_name": name},
	}}
}

func TestLocalPreviewAllResourcesWithoutAWS(t *testing.T) {
	t.Setenv("AWS_CONFIG_FILE", filepath.Join(t.TempDir(), "missing"))
	t.Setenv("AWS_SHARED_CREDENTIALS_FILE", filepath.Join(t.TempDir(), "missing"))
	t.Setenv("AWS_EC2_METADATA_DISABLED", "true")
	t.Setenv("AWS_ENDPOINT_URL", "http://127.0.0.1:1")
	layout := generic.DiagramLayout{Nodes: []generic.DiagramNode{
		previewNode("api", "API Gateway", "demo-api"),
		previewNode("function", "Lambda", "demo-function"),
		previewNode("bucket", "S3", "demo-bucket"),
		previewNode("table", "DynamoDB", "demo-table"),
		previewNode("server", "EC2 Container", "demo-server"),
	}, Edges: []generic.DiagramEdge{{ID: "edge", Source: "function", Target: "bucket"}}}
	files, err := GenerateLocal(context.Background(), localTemplates(t), layout)
	if err != nil {
		t.Fatal(err)
	}
	for _, block := range []string{"aws_api_gateway_rest_api", "aws_lambda_function", "aws_s3_bucket", "aws_dynamodb_table", "aws_instance", "aws_iam_policy"} {
		if !strings.Contains(files["main.tf"], `resource "`+block+`"`) {
			t.Errorf("missing %s", block)
		}
	}
	if len(files) != 2 || !strings.Contains(files["outputs.tf"], "demo_bucket") {
		t.Fatalf("unexpected output files: %v", files)
	}
	if layout.Nodes[0].Variables != nil {
		t.Fatal("preview mutated its caller's layout")
	}
}

func TestLocalPreviewRejectsIncompleteOrInvalidDiagram(t *testing.T) {
	for _, test := range []struct {
		name   string
		layout generic.DiagramLayout
	}{
		{"empty", generic.DiagramLayout{}},
		{"bad-name", generic.DiagramLayout{Nodes: []generic.DiagramNode{previewNode("a", "S3", `bad"name`)}}},
		{"unknown-resource", generic.DiagramLayout{Nodes: []generic.DiagramNode{previewNode("a", "Unknown", "demo")}}},
		{"collision", generic.DiagramLayout{Nodes: []generic.DiagramNode{previewNode("a", "S3", "demo-bucket"), previewNode("b", "S3", "demo_bucket")}}},
		{"dangling-edge", generic.DiagramLayout{Nodes: []generic.DiagramNode{previewNode("a", "S3", "demo")}, Edges: []generic.DiagramEdge{{Source: "a", Target: "missing"}}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			files, err := GenerateLocal(context.Background(), localTemplates(t), test.layout)
			if err == nil || files != nil {
				t.Fatalf("expected an error with no partial files, got %v %v", files, err)
			}
		})
	}
}

func TestLocalPreviewEscapesHCLValues(t *testing.T) {
	node := previewNode("a", "API Gateway", "demo-api")
	node.Data["variables"].(map[string]any)["description"] = "quote\"\n${file(\"secret\")} %{if true}\x01\b\f"
	files, err := GenerateLocal(context.Background(), localTemplates(t), generic.DiagramLayout{Nodes: []generic.DiagramNode{node}})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(files["main.tf"], `quote\"\n$${file(\"secret\")} %%{if true}\u0001\u0008\u000c`) {
		t.Fatalf("unsafe HCL description: %s", files["main.tf"])
	}
}

func TestLocalPreviewMissingOutputsFailsWithoutPartialFiles(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "aws", "s3"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "aws", "s3", "main.tf.tmpl"), []byte("resource {}"), 0600); err != nil {
		t.Fatal(err)
	}
	files, err := GenerateLocal(context.Background(), root, generic.DiagramLayout{Nodes: []generic.DiagramNode{previewNode("a", "S3", "demo")}})
	if err == nil || files != nil {
		t.Fatalf("expected missing outputs error, got %v %v", files, err)
	}
}
