package template

import (
	"context"
	"fmt"
	"io"
	"sync"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

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

	// A disk-only loader must never fall through to AWS on a cache miss.
	if l.s3Client == nil {
		return nil, fmt.Errorf("local template not found: %s", templatePath)
	}

	// Fetch from S3
	result, err := l.s3Client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(l.bucketName),
		Key:    aws.String(templatePath),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to fetch template %s from S3: %w", templatePath, err)
	}
	defer result.Body.Close()

	content, err := io.ReadAll(result.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read template content: %w", err)
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
