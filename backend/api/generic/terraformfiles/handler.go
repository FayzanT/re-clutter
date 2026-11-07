package terraformfiles

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/Alberta2514640/clutter/backend/api/generic"
	"github.com/aws/aws-lambda-go/events"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Database is the part of a Postgres connection the handler needs.
type Database interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Deps are the outside systems of one request. The Lambda's main.go supplies
// the real ones.
type Deps struct {
	Bucket   string
	Connect  func(ctx context.Context) (Database, func(), error)
	NewStore func(ctx context.Context) (Store, error)
}

// diagramForMemberQuery proves the diagram, the project and the caller's
// membership in one step. The organization comes from the project row, never
// from the request, so one row back means all three belong together.
const diagramForMemberQuery = `
	SELECT p.organization_id, d.latest_update_at
	FROM diagrams d
	JOIN projects p ON p.id = d.project_id
	JOIN organization_members m ON m.organization_id = p.organization_id
	WHERE d.id = $1 AND p.id = $2 AND m.member_id = $3`

// Handle serves GET /terraform-engine/files.
func Handle(ctx context.Context, request events.APIGatewayProxyRequest, deps Deps) (events.APIGatewayProxyResponse, error) {
	projectID, projectOK := canonicalUUID(request.QueryStringParameters["projectId"])
	diagramID, diagramOK := canonicalUUID(request.QueryStringParameters["diagramId"])
	if !projectOK || !diagramOK {
		return generic.Response(http.StatusBadRequest, generic.Json{
			"message": "valid projectId and diagramId are required",
		})
	}

	userData, err := generic.GetUserDataFromAuthorizerContext(request.RequestContext.Authorizer)
	if err != nil {
		return generic.Response(http.StatusUnauthorized, generic.Json{
			"message": "failed to get user from authorizer context",
		})
	}

	if deps.Bucket == "" {
		return generic.Response(http.StatusInternalServerError, generic.Json{
			"message": "S3_BUCKET_NAME is not configured",
		})
	}

	db, closeDB, err := deps.Connect(ctx)
	if err != nil {
		return generic.Response(http.StatusInternalServerError, generic.Json{
			"message": "failed to connect to database",
		})
	}
	defer closeDB()

	var orgID string
	var diagramUpdatedAt *time.Time
	err = db.QueryRow(ctx, diagramForMemberQuery, diagramID, projectID, userData.Id).Scan(&orgID, &diagramUpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		// One answer for "no such diagram" and "not yours", so a caller cannot
		// learn that another tenant's id exists.
		return generic.Response(http.StatusNotFound, generic.Json{
			"message": "diagram not found",
		})
	}
	if err != nil {
		return generic.Response(http.StatusInternalServerError, generic.Json{
			"message": "failed to look up the diagram",
		})
	}

	store, err := deps.NewStore(ctx)
	if err != nil {
		return generic.Response(http.StatusInternalServerError, generic.Json{
			"message": "failed to load AWS config",
		})
	}

	files, status, err := Read(ctx, store, deps.Bucket, Folder(orgID, projectID, diagramID))
	if errors.Is(err, ErrTooLarge) {
		return generic.Response(http.StatusRequestEntityTooLarge, generic.Json{
			"message": ErrTooLarge.Error(),
		})
	}
	if err != nil {
		return generic.Response(http.StatusInternalServerError, generic.Json{
			"message": "failed to read the generated files",
		})
	}

	generated := len(files) > 0 || status != nil
	message := "generated files returned"
	if !generated {
		message = "no Terraform has been generated for this diagram yet"
	}
	return generic.Response(http.StatusOK, generic.Json{
		"message": message,
		"data": generic.Json{
			"generated": generated,
			"current":   coversLatestSave(status, diagramUpdatedAt),
			"files":     files,
			"status":    status,
		},
	})
}

// canonicalUUID accepts the same ids as generic.IsValidUuid and returns the
// plain lowercase form, since the id goes into an S3 key.
func canonicalUUID(id string) (string, bool) {
	if !generic.IsValidUuid(id) {
		return "", false
	}
	return uuid.MustParse(id).String(), true
}

// coversLatestSave reports whether the status belongs to a run of the diagram's
// newest save. False means a run is pending, or the files predate the status
// file.
func coversLatestSave(status *Status, diagramUpdatedAt *time.Time) bool {
	if status == nil {
		return false
	}
	if diagramUpdatedAt == nil {
		return status.DiagramUpdatedAt == ""
	}
	seen, err := time.Parse(time.RFC3339, status.DiagramUpdatedAt)
	return err == nil && seen.Equal(*diagramUpdatedAt)
}
