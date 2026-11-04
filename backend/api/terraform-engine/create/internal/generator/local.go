package generator

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/Alberta2514640/clutter/backend/api/generic"
	"github.com/Alberta2514640/clutter/backend/api/terraform-engine/create/internal/generator/iam"
	"github.com/Alberta2514640/clutter/backend/api/terraform-engine/create/internal/generator/resources"
	"github.com/Alberta2514640/clutter/backend/api/terraform-engine/create/internal/generator/template"
)

var localResourceName = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,62}$`)
var localEnvironmentKey = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

// GenerateLocal is a read-only preview of the existing AWS generator. Its
// templates come from disk; it never creates a writer or loads AWS config.
// The returned files are examples for inspection, not a validated deploy plan.
func GenerateLocal(ctx context.Context, uploadsDir string, layout generic.DiagramLayout) (map[string]string, error) {
	if len(layout.Nodes) == 0 {
		return nil, fmt.Errorf("add and save at least one resource before previewing Terraform")
	}
	if len(layout.Nodes) > 200 || len(layout.Edges) > 1000 {
		return nil, fmt.Errorf("preview supports up to 200 nodes and 1000 connections")
	}
	loader, err := template.NewLocalTemplateLoader(uploadsDir)
	if err != nil {
		return nil, err
	}
	layout.Nodes = append([]generic.DiagramNode(nil), layout.Nodes...)
	names, ids := map[string]bool{}, map[string]bool{}
	for i := range layout.Nodes {
		node := &layout.Nodes[i]
		if node.ID == "" || ids[node.ID] {
			return nil, fmt.Errorf("every resource needs a unique node id")
		}
		ids[node.ID] = true
		label, _ := node.Data["label"].(string)
		kind, err := resources.ParseResourceType(label)
		if err != nil {
			return nil, err
		}
		variables, ok := node.Data["variables"].(map[string]any)
		if !ok {
			return nil, fmt.Errorf("%s needs a resource name; configure and save the diagram", label)
		}
		name, _ := variables["resource_name"].(string)
		if !localResourceName.MatchString(name) {
			return nil, fmt.Errorf("%s resource name must start with a lowercase letter and contain at most 63 lowercase letters, digits, hyphens or underscores", label)
		}
		sanitized := sanitizeResourceName(name)
		if names[sanitized] {
			return nil, fmt.Errorf("resource names must stay unique after hyphens become underscores")
		}
		names[sanitized] = true
		// Existing templates insert strings inside HCL quotes. Escape here so a
		// preview cannot turn a diagram value into additional executable HCL.
		node.Variables = make(map[string]any, len(variables))
		for key, value := range variables {
			if text, ok := value.(string); ok {
				if len(text) > 4096 {
					return nil, fmt.Errorf("%s variable %s is too long", label, key)
				}
				value = escapeLocalHCL(text)
			}
			if key == "environment_variables" {
				environment, ok := value.(map[string]any)
				if !ok {
					return nil, fmt.Errorf("Lambda environment variables must be a string map")
				}
				safe := make(map[string]any, len(environment))
				for envKey, envValue := range environment {
					text, ok := envValue.(string)
					if !ok || !localEnvironmentKey.MatchString(envKey) || len(text) > 4096 {
						return nil, fmt.Errorf("invalid Lambda environment variable")
					}
					safe[envKey] = escapeLocalHCL(text)
				}
				value = safe
			}
			node.Variables[key] = value
		}
		resource, err := resources.GetGenerator(ctx, kind, loader)
		if err != nil {
			return nil, err
		}
		// The original GetOutputs API returns an empty string on failure.
		// Refuse the preview rather than silently returning incomplete files.
		if resource.GetOutputs(sanitized) == "" {
			return nil, fmt.Errorf("cannot render %s outputs from local templates", label)
		}
	}
	for _, edge := range layout.Edges {
		if !ids[edge.Source] || !ids[edge.Target] {
			return nil, fmt.Errorf("a connection references a resource not in this diagram")
		}
	}
	g := &TerraformGenerator{iamGenerator: iam.NewIAMPolicyGenerator(), templateLoader: loader}
	generated, generationErrors := g.Generate(ctx, "local-preview", layout)
	if len(generationErrors) > 0 {
		return nil, fmt.Errorf("%s: %s", generationErrors[0].NodeLabel, generationErrors[0].Message)
	}
	return map[string]string{
		"main.tf":    generated.MainTF + "\n" + generated.ResourcesTF + "\n" + generated.IAMTF,
		"outputs.tf": generated.OutputsTF,
	}, nil
}

func escapeLocalHCL(value string) string {
	// HCL accepts fewer escapes than Go and JSON: for example, neither
	// \\xNN nor \\b is valid. Encode controls using Unicode escapes.
	var escaped strings.Builder
	for _, r := range value {
		switch r {
		case '"', '\\':
			escaped.WriteByte('\\')
			escaped.WriteRune(r)
		case '\n':
			escaped.WriteString(`\n`)
		case '\r':
			escaped.WriteString(`\r`)
		case '\t':
			escaped.WriteString(`\t`)
		default:
			if r < 0x20 || r == 0x7f {
				fmt.Fprintf(&escaped, `\u%04x`, r)
			} else {
				escaped.WriteRune(r)
			}
		}
	}
	return strings.NewReplacer("${", "$${", "%{", "%%{").Replace(escaped.String())
}
