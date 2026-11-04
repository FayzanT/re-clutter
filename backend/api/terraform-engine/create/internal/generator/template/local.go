package template

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	texttemplate "text/template"
)

// NewLocalTemplateLoader reads the checked-in uploads directory once. It has
// no S3 client, AWS configuration or network fallback.
func NewLocalTemplateLoader(uploadsDir string) (*TemplateLoader, error) {
	loader := &TemplateLoader{cache: make(map[string]*Template)}
	err := filepath.WalkDir(uploadsDir, func(filename string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(filename, ".tf.tmpl") {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("local template must not be a symlink")
		}
		content, err := os.ReadFile(filename)
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(uploadsDir, filename)
		if err != nil {
			return err
		}
		key := "templates/" + filepath.ToSlash(relative)
		if _, err := texttemplate.New(key).Parse(string(content)); err != nil {
			return fmt.Errorf("invalid local template %s: %w", key, err)
		}
		loader.cache[key] = &Template{Name: key, Content: string(content)}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("load local templates: %w", err)
	}
	if len(loader.cache) == 0 {
		return nil, fmt.Errorf("no local Terraform templates found")
	}
	return loader, nil
}
