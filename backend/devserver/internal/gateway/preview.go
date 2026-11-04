package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type previewHandler struct {
	server *Server
	load   func(context.Context, string, string, string) (json.RawMessage, error)
	render func(context.Context, json.RawMessage) (map[string]string, error)
}

// TerraformPreviewHandler is registered only by the loopback development
// gateway. Unlike deployment it needs no linked AWS role and writes no data.
func (s *Server) TerraformPreviewHandler(connectionString, binary, templates string) http.Handler {
	return &previewHandler{
		server: s,
		load: func(ctx context.Context, userID, projectID, diagramID string) (json.RawMessage, error) {
			conn, err := pgx.Connect(ctx, connectionString)
			if err != nil {
				return nil, err
			}
			defer conn.Close(ctx)
			var layout json.RawMessage
			// Prove the whole ownership chain in the same query. An account
			// link, caller-provided org id, or membership alone is insufficient.
			err = conn.QueryRow(ctx, `
				SELECT d.data FROM diagrams d
				JOIN projects p ON p.id = d.project_id
				JOIN organization_members m ON m.organization_id = p.organization_id
				WHERE d.id = $1 AND p.id = $2 AND m.member_id = $3`,
				diagramID, projectID, userID).Scan(&layout)
			return layout, err
		},
		render: func(ctx context.Context, layout json.RawMessage) (map[string]string, error) {
			cmd := exec.CommandContext(ctx, binary, "-templates", templates)
			cmd.Env = []string{} // The preview has no cloud credentials or SDK config.
			cmd.Stdin = bytes.NewReader(layout)
			var output boundedPreviewOutput
			cmd.Stdout = &output
			cmd.Stderr = io.Discard
			err := cmd.Run()
			var result struct {
				Files map[string]string `json:"files"`
				Error string            `json:"error"`
			}
			if json.Unmarshal(output.Bytes(), &result) != nil {
				return nil, fmt.Errorf("local Terraform generator could not finish; restart the devserver and retry")
			}
			if result.Error != "" {
				return nil, errors.New(result.Error)
			}
			if err != nil || result.Files["main.tf"] == "" || result.Files["outputs.tf"] == "" {
				return nil, fmt.Errorf("local Terraform generator returned incomplete files")
			}
			return result.Files, nil
		},
	}
}

func (h *previewHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Authorization,Content-Type")
	w.Header().Set("Access-Control-Allow-Methods", "GET,OPTIONS")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET,OPTIONS")
		previewError(w, http.StatusMethodNotAllowed, "use GET for Terraform preview")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	r = r.WithContext(ctx)
	event := buildEvent(r, "/dev/terraform-preview", nil, nil)
	auth, status, errorType, errorBody := h.server.authorize(r, event)
	if status != 0 {
		writeGatewayError(w, status, errorType, errorBody)
		return
	}
	userID, ok := auth["id"].(string)
	if !ok || userID == "" {
		previewError(w, http.StatusUnauthorized, "sign in before previewing Terraform")
		return
	}
	projectID, diagramID := r.URL.Query().Get("projectId"), r.URL.Query().Get("diagramId")
	if uuid.Validate(projectID) != nil || uuid.Validate(diagramID) != nil {
		previewError(w, http.StatusBadRequest, "valid projectId and diagramId are required")
		return
	}
	layout, err := h.load(ctx, userID, projectID, diagramID)
	if errors.Is(err, pgx.ErrNoRows) {
		previewError(w, http.StatusNotFound, "diagram not found or not accessible")
		return
	}
	if err != nil {
		previewError(w, http.StatusInternalServerError, "could not read the saved diagram")
		return
	}
	if len(layout) > maxPayload {
		previewError(w, http.StatusRequestEntityTooLarge, "diagram is too large to preview")
		return
	}
	files, err := h.render(ctx, layout)
	if err != nil {
		previewError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"files": files}})
}

func previewError(w http.ResponseWriter, status int, message string) {
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

type boundedPreviewOutput struct{ bytes.Buffer }

func (b *boundedPreviewOutput) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 4<<20 {
		return 0, fmt.Errorf("Terraform preview output exceeded 4 MB")
	}
	return b.Buffer.Write(p)
}
