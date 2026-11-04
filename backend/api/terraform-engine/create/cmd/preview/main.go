// Command preview renders the existing AWS templates locally without an AWS SDK
// configuration, cloud calls, credentials or deployment. Used by devserver only.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/Alberta2514640/clutter/backend/api/generic"
	"github.com/Alberta2514640/clutter/backend/api/terraform-engine/create/internal/generator"
)

func main() {
	uploadsDir := flag.String("templates", "", "checked-in S3 uploads directory")
	flag.Parse()
	var layout generic.DiagramLayout
	if err := json.NewDecoder(io.LimitReader(os.Stdin, 10<<20)).Decode(&layout); err != nil {
		fmt.Fprintln(os.Stderr, "invalid diagram JSON")
		os.Exit(1)
	}
	// The existing generator writes debug lines to stdout. Keep its diagnostics
	// on stderr so this command's stdout is exclusively its JSON response.
	output := os.Stdout
	os.Stdout = os.Stderr
	files, err := generator.GenerateLocal(context.Background(), *uploadsDir, layout)
	if err != nil {
		_ = json.NewEncoder(output).Encode(map[string]string{"error": err.Error()})
		os.Exit(1)
	}
	if err := json.NewEncoder(output).Encode(map[string]any{"files": files}); err != nil {
		os.Exit(1)
	}
}
