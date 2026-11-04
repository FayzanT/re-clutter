package generator

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/Alberta2514640/clutter/backend/api/generic"
	"github.com/Alberta2514640/clutter/backend/api/terraform-engine/create/internal"
	"github.com/Alberta2514640/clutter/backend/api/terraform-engine/create/internal/generator/iam"
	"github.com/Alberta2514640/clutter/backend/api/terraform-engine/create/internal/generator/resources"
	"github.com/Alberta2514640/clutter/backend/api/terraform-engine/create/internal/generator/template"
	"github.com/Alberta2514640/clutter/backend/api/terraform-engine/create/internal/generator/writer"
)

type TerraformGenerator struct {
	iamGenerator   *iam.IAMPolicyGenerator
	templateLoader *template.TemplateLoader
}

func NewTerraformGenerator(ctx context.Context, templateBucket string) (*TerraformGenerator, error) {
	loader, err := template.NewTemplateLoader(ctx, templateBucket)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize template loader: %w", err)
	}

	return &TerraformGenerator{
		iamGenerator:   iam.NewIAMPolicyGenerator(),
		templateLoader: loader,
	}, nil
}

// Generate processes a diagram and returns generated terraform
func (g *TerraformGenerator) Generate(ctx context.Context, diagramID string, layout generic.DiagramLayout) (*internal.GeneratedTerraform, []internal.GenerationError) {
	var errors []internal.GenerationError
	var resourceBlocks []string
	var outputBlocks []string

	// Parse nodes into TerraformResources
	tfResources, parseErrors := g.parseNodes(layout.Nodes)
	errors = append(errors, parseErrors...)

	// Build resource lookup map
	resourceMap := make(map[string]*internal.TerraformResource)
	for _, res := range tfResources {
		resourceMap[res.SourceNodeID] = res
	}

	// Generate terraform for each resource
	for _, res := range tfResources {
		gen, err := resources.GetGenerator(ctx, res.Type, g.templateLoader)
		if err != nil {
			errors = append(errors, internal.GenerationError{
				NodeID:    res.SourceNodeID,
				NodeLabel: string(res.Type),
				ErrorType: "generator_error",
				Message:   err.Error(),
			})
			continue
		}

		// Find original node for generation
		var node generic.DiagramNode
		for _, n := range layout.Nodes {
			if n.ID == res.SourceNodeID {
				node = n
				break
			}
		}

		block, err := gen.Generate(node, res.Name)
		if err != nil {
			errors = append(errors, internal.GenerationError{
				NodeID:    res.SourceNodeID,
				NodeLabel: string(res.Type),
				ErrorType: generationErrorType(err),
				Message:   err.Error(),
			})
			continue
		}

		resourceBlocks = append(resourceBlocks, block)
		outputBlocks = append(outputBlocks, gen.GetOutputs(res.Name))
	}

	// Parse edges into IAM relationships
	relationships := g.parseEdges(layout.Edges, resourceMap)
	fmt.Println("Parsed relationships:", relationships)

	// Generate IAM policies
	iamTF, _ := g.iamGenerator.GenerateFromRelationships(relationships)

	return &internal.GeneratedTerraform{
		DiagramID:   diagramID,
		MainTF:      writer.GenerateMainTF(),
		ResourcesTF: strings.Join(resourceBlocks, "\n"),
		IAMTF:       iamTF,
		VariablesTF: "", // Variables are inlined for simplicity
		OutputsTF:   strings.Join(outputBlocks, "\n"),
	}, errors
}

// generationErrorType separates a failure of Clutter's templates, whose text the
// user must not see, from a fault in the diagram, whose text they act on.
func generationErrorType(err error) string {
	if errors.Is(err, template.ErrFailed) {
		return internal.ErrorTypeTemplate
	}
	return "generation_error"
}

// parseNodes converts diagram nodes to TerraformResources
func (g *TerraformGenerator) parseNodes(nodes []generic.DiagramNode) ([]*internal.TerraformResource, []internal.GenerationError) {
	var tfResources []*internal.TerraformResource
	var errors []internal.GenerationError

	for _, node := range nodes {
		label, ok := node.Data["label"].(string)
		if !ok {
			errors = append(errors, internal.GenerationError{
				NodeID:    node.ID,
				ErrorType: "missing_label",
				Message:   "node has no label in data",
			})
			continue
		}

		resourceType, err := resources.ParseResourceType(label)
		if err != nil {
			errors = append(errors, internal.GenerationError{
				NodeID:    node.ID,
				NodeLabel: label,
				ErrorType: "unknown_label",
				Message:   err.Error(),
			})
			continue
		}

		// Get resource_name for naming (fallback to resource type)
		resourceName, _ := node.Variables["resource_name"].(string)
		if resourceName == "" {
			resourceName = string(resourceType)
		}

		tfResources = append(tfResources, &internal.TerraformResource{
			ID:           node.ID,
			Name:         sanitizeResourceName(resourceName),
			Type:         resourceType,
			Variables:    node.Variables,
			SourceNodeID: node.ID,
		})
	}

	return tfResources, errors
}

// parseEdges converts edges to IAMRelationships
func (g *TerraformGenerator) parseEdges(edges []generic.DiagramEdge, resourceMap map[string]*internal.TerraformResource) []*internal.IAMRelationship {
	var relationships []*internal.IAMRelationship

	for _, edge := range edges {
		sourceRes, sourceOK := resourceMap[edge.Source]
		targetRes, targetOK := resourceMap[edge.Target]

		if !sourceOK || !targetOK {
			continue // Skip edges with unknown nodes
		}

		relationships = append(relationships, &internal.IAMRelationship{
			SourceResource: sourceRes,
			TargetResource: targetRes,
			EdgeID:         edge.ID,
			EdgeLabel:      edge.Label,
		})
	}

	return relationships
}

// sanitizeResourceName converts a name to a valid TF resource name
func sanitizeResourceName(name string) string {
	// Convert to lowercase and replace spaces/special chars with underscores
	name = strings.ToLower(name)
	reg := regexp.MustCompile(`[^a-z0-9]+`)
	name = reg.ReplaceAllString(name, "_")
	name = strings.Trim(name, "_")

	return name
}
