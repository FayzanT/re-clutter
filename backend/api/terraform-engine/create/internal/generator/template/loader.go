package template

import (
	"context"
	"errors"
	"fmt"
	"io"
	"sync"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// ErrFailed marks a failure of Clutter's own templates or the bucket that holds
// them, as opposed to a fault in the user's diagram. Its text holds bucket paths
// and SDK errors, so it is for the log, never for the user.
var ErrFailed = errors.New("terraform template failed")

type Template struct {
	Name    string
	Content string
}

type TemplateLoader struct {
	s3Client   *s3.Client
	bucketName string
	cache      map[string]*Template
	cacheMutex sync.RWMutex
}

func NewTemplateLoader(ctx context.Context, bucketName string) (*TemplateLoader, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion("us-west-2"))
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %w", err)
	}

	return &TemplateLoader{
		s3Client:   s3.NewFromConfig(cfg),
		bucketName: bucketName,
		cache:      make(map[string]*Template),
	}, nil
}

// Load retrieves a template from S3 or cache
func (l *TemplateLoader) Load(ctx context.Context, templatePath string) (*Template, error) {
	// Check cache first
	l.cacheMutex.RLock()
	if tmpl, exists := l.cache[templatePath]; exists {
		l.cacheMutex.RUnlock()
		return tmpl, nil
	}
	l.cacheMutex.RUnlock()

	// Fetch from S3
	result, err := l.s3Client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(l.bucketName),
		Key:    aws.String(templatePath),
	})
	if err != nil {
		return nil, fmt.Errorf("%w: failed to fetch template %s from S3: %w", ErrFailed, templatePath, err)
	}
	defer result.Body.Close()

	content, err := io.ReadAll(result.Body)
	if err != nil {
		return nil, fmt.Errorf("%w: failed to read template content: %w", ErrFailed, err)
	}

	tmpl := &Template{
		Name:    templatePath,
		Content: string(content),
	}

	// Store in cache
	l.cacheMutex.Lock()
	l.cache[templatePath] = tmpl
	l.cacheMutex.Unlock()

	return tmpl, nil
}

// LoadResourceTemplates loads all templates for a resource type (main.tf.tmpl, outputs.tf.tmpl)
func (l *TemplateLoader) LoadResourceTemplates(ctx context.Context, resourceType string) (map[string]*Template, error) {
	templates := make(map[string]*Template)
	templateFiles := []string{"main.tf.tmpl", "outputs.tf.tmpl"}

	for _, file := range templateFiles {
		path := fmt.Sprintf("templates/aws/%s/%s", resourceType, file)
		tmpl, err := l.Load(ctx, path)
		if err != nil {
			return nil, fmt.Errorf("failed to load %s: %w", file, err)
		}
		templates[file] = tmpl
	}

	return templates, nil
}
