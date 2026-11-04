package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5"
)

const previewURL = "/dev/terraform-preview?projectId=11111111-1111-4111-8111-111111111111&diagramId=22222222-2222-4222-8222-222222222222"

func TestPreviewAuthenticationAndAccess(t *testing.T) {
	for _, tc := range []struct {
		name      string
		auth      string
		allow     bool
		loadError error
		status    int
	}{
		{"no-token", "", true, nil, http.StatusUnauthorized},
		{"invalid-token", "bad", false, nil, http.StatusForbidden},
		{"other-tenant-or-wrong-project", "valid", true, pgx.ErrNoRows, http.StatusNotFound},
		{"database-error", "valid", true, errors.New("private connection details"), http.StatusInternalServerError},
		{"member", "valid", true, nil, http.StatusOK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := &fakeInvoker{allow: tc.allow}
			s := NewServer(f, log.New(io.Discard, "", 0), nil)
			loaded, rendered := false, false
			h := &previewHandler{server: s,
				load: func(_ context.Context, user, project, diagram string) (json.RawMessage, error) {
					loaded = true
					if user != "user-1" || project != "11111111-1111-4111-8111-111111111111" || diagram != "22222222-2222-4222-8222-222222222222" {
						t.Fatalf("wrong authenticated ownership inputs: %s %s %s", user, project, diagram)
					}
					return json.RawMessage(`{"nodes":[],"edges":[]}`), tc.loadError
				},
				render: func(_ context.Context, layout json.RawMessage) (map[string]string, error) {
					rendered = true
					return map[string]string{"main.tf": "main", "outputs.tf": "outputs"}, nil
				},
			}
			req := httptest.NewRequest("GET", previewURL, nil)
			req.Header.Set("Authorization", tc.auth)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tc.status {
				t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
			}
			if (!tc.allow || tc.auth == "") && loaded {
				t.Fatal("unauthenticated request reached the database")
			}
			if rendered != (tc.status == http.StatusOK) {
				t.Fatal("generation must only happen after ownership is proved")
			}
			if rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("preview must not be cached")
			}
		})
	}
}

func TestPreviewValidationAndErrors(t *testing.T) {
	s := NewServer(&fakeInvoker{allow: true}, log.New(io.Discard, "", 0), nil)
	for _, tc := range []struct {
		method, target string
		status         int
	}{
		{"OPTIONS", previewURL, http.StatusNoContent},
		{"POST", previewURL, http.StatusMethodNotAllowed},
		{"GET", "/dev/terraform-preview?projectId=invalid", http.StatusBadRequest},
		{"GET", previewURL, http.StatusUnprocessableEntity},
	} {
		h := &previewHandler{server: s,
			load: func(context.Context, string, string, string) (json.RawMessage, error) {
				return json.RawMessage(`{}`), nil
			},
			render: func(context.Context, json.RawMessage) (map[string]string, error) {
				return nil, errors.New("invalid resource name")
			},
		}
		req := httptest.NewRequest(tc.method, tc.target, nil)
		req.Header.Set("Authorization", "valid")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != tc.status {
			t.Fatalf("%s %s: status %d body %s", tc.method, tc.target, rec.Code, rec.Body.String())
		}
	}
}
