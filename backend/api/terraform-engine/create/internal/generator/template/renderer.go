package template

import (
	"bytes"
	"fmt"
	"text/template"
)

type RenderContext struct {
	ResourceName string
	Variables    map[string]interface{}
}

// Render executes a template with the given variables
func Render(tmpl *Template, vars map[string]interface{}) (string, error) {
	t, err := template.New(tmpl.Name).Parse(tmpl.Content)
	if err != nil {
		return "", fmt.Errorf("%w: failed to parse template %s: %w", ErrFailed, tmpl.Name, err)
	}

	var buf bytes.Buffer
	if err := t.Execute(&buf, vars); err != nil {
		return "", fmt.Errorf("%w: failed to render template %s: %w", ErrFailed, tmpl.Name, err)
	}

	return buf.String(), nil
}