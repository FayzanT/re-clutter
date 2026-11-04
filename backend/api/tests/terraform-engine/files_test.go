package terraform_engine_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/Alberta2514640/clutter/backend/api/generic/terraformfiles"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
)

const (
	projectID = "11111111-1111-4111-8111-111111111111"
	diagramID = "22222222-2222-4222-8222-222222222222"
	orgID     = "33333333-3333-4333-8333-333333333333"
	userID    = "44444444-4444-4444-8444-444444444444"
	folder    = orgID + "/" + projectID + "/" + diagramID + "/terraform/"
)

// fakeBucket answers like S3 for one bucket held in memory.
type fakeBucket struct {
	objects   map[string]string
	truncated bool
	gone      map[string]bool // listed, then deleted before the read
	listErr   error
	reads     []string
}

func (f *fakeBucket) ListObjectsV2(_ context.Context, in *s3.ListObjectsV2Input, _ ...func(*s3.Options)) (*s3.ListObjectsV2Output, error) {
	if f.listErr != nil {
		return nil, f.listErr
	}
	prefix := aws.ToString(in.Prefix)
	out := &s3.ListObjectsV2Output{IsTruncated: aws.Bool(f.truncated)}
	for key, body := range f.objects {
		rest, ok := strings.CutPrefix(key, prefix)
		if !ok {
			continue
		}
		if i := strings.Index(rest, aws.ToString(in.Delimiter)); i >= 0 {
			out.CommonPrefixes = append(out.CommonPrefixes, types.CommonPrefix{Prefix: aws.String(prefix + rest[:i+1])})
			continue
		}
		out.Contents = append(out.Contents, types.Object{Key: aws.String(key), Size: aws.Int64(int64(len(body)))})
	}
	return out, nil
}

func (f *fakeBucket) GetObject(_ context.Context, in *s3.GetObjectInput, _ ...func(*s3.Options)) (*s3.GetObjectOutput, error) {
	key := aws.ToString(in.Key)
	f.reads = append(f.reads, key)
	body, ok := f.objects[key]
	if !ok || f.gone[key] {
		return nil, &types.NoSuchKey{}
	}
	return &s3.GetObjectOutput{Body: io.NopCloser(strings.NewReader(body))}, nil
}

type answer struct {
	Message string `json:"message"`
	Data    struct {
		Generated bool                   `json:"generated"`
		Current   bool                   `json:"current"`
		Files     map[string]string      `json:"files"`
		Status    *terraformfiles.Status `json:"status"`
	} `json:"data"`
}

func request(project, diagram string) events.APIGatewayProxyRequest {
	return events.APIGatewayProxyRequest{
		QueryStringParameters: map[string]string{"projectId": project, "diagramId": diagram},
		RequestContext: events.APIGatewayProxyRequestContext{
			Authorizer: map[string]any{"id": userID},
		},
	}
}

// run sends one request through the real handler, with a mocked database that
// finds the diagram last saved at updatedAt.
func run(t *testing.T, req events.APIGatewayProxyRequest, bucket *fakeBucket, updatedAt *time.Time) (int, answer) {
	t.Helper()
	mock, err := pgxmock.NewConn()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close(context.Background())
	mock.ExpectQuery(`FROM diagrams d\s+JOIN projects p ON p.id = d.project_id\s+JOIN organization_members m`).
		WithArgs(diagramID, projectID, userID).
		WillReturnRows(pgxmock.NewRows([]string{"organization_id", "latest_update_at"}).AddRow(orgID, updatedAt))

	return handle(t, req, mock, bucket)
}

func handle(t *testing.T, req events.APIGatewayProxyRequest, db terraformfiles.Database, bucket *fakeBucket) (int, answer) {
	t.Helper()
	res, err := terraformfiles.Handle(context.Background(), req, terraformfiles.Deps{
		Bucket:   "bucket",
		Connect:  func(context.Context) (terraformfiles.Database, func(), error) { return db, func() {}, nil },
		NewStore: func(context.Context) (terraformfiles.Store, error) { return bucket, nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	var out answer
	if err := json.Unmarshal([]byte(res.Body), &out); err != nil {
		t.Fatalf("body %q: %v", res.Body, err)
	}
	return res.StatusCode, out
}

func statusJSON(t *testing.T, status terraformfiles.Status) string {
	t.Helper()
	raw, err := json.Marshal(status)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestReturnsOnlyTerraformFilesAndTheStatus(t *testing.T) {
	saved := time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC)
	savedText := "2026-11-04T10:00:00+00:00"
	bucket := &fakeBucket{objects: map[string]string{
		folder + "main.tf":                     "main",
		folder + "outputs.tf":                  "outputs",
		folder + "status.json":                 statusJSON(t, terraformfiles.NewStatus("", &savedText, saved)),
		folder + "terraform.tfstate":           `{"secrets":"state"}`,
		folder + "terraform.tfstate.backup":    `{"secrets":"backup"}`,
		folder + "secrets.tfvars":              "password=1",
		folder + "logs/run1/command.log":       "log",
		folder + "logs/run1/nested.tf":         "not direct",
		"other-org/p/d/terraform/main.tf":      "other tenant",
		orgID + "/" + projectID + "/x/main.tf": "other folder",
	}}

	code, out := run(t, request(projectID, diagramID), bucket, &saved)
	if code != http.StatusOK {
		t.Fatalf("status %d: %+v", code, out)
	}
	if len(out.Data.Files) != 2 || out.Data.Files["main.tf"] != "main" || out.Data.Files["outputs.tf"] != "outputs" {
		t.Fatalf("files: %v", out.Data.Files)
	}
	if !out.Data.Generated || !out.Data.Current {
		t.Fatalf("generated %v current %v", out.Data.Generated, out.Data.Current)
	}
	if out.Data.Status == nil || out.Data.Status.State != terraformfiles.StateSuccess {
		t.Fatalf("status: %+v", out.Data.Status)
	}
	for _, key := range bucket.reads {
		if strings.Contains(key, "tfstate") || strings.Contains(key, "tfvars") {
			t.Fatalf("read %s", key)
		}
	}
}

func TestNotGeneratedYet(t *testing.T) {
	code, out := run(t, request(projectID, diagramID), &fakeBucket{objects: map[string]string{}}, nil)
	if code != http.StatusOK {
		t.Fatalf("status %d", code)
	}
	if out.Data.Generated || out.Data.Current || out.Data.Status != nil || len(out.Data.Files) != 0 {
		t.Fatalf("data: %+v", out.Data)
	}
	if !strings.Contains(out.Message, "generated") {
		t.Fatalf("message: %q", out.Message)
	}
}

func TestAStatusFromAnOlderSaveIsNotCurrent(t *testing.T) {
	older := "2026-11-04T09:00:00+00:00"
	newest := time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC)
	bucket := &fakeBucket{objects: map[string]string{
		folder + "main.tf":     "main",
		folder + "status.json": statusJSON(t, terraformfiles.NewStatus("", &older, newest)),
	}}
	_, out := run(t, request(projectID, diagramID), bucket, &newest)
	if out.Data.Current {
		t.Fatal("a run of an older save must not read as current")
	}
}

func TestAFailedRunStillReturnsTheLastGoodFiles(t *testing.T) {
	bucket := &fakeBucket{objects: map[string]string{
		folder + "main.tf":     "last good",
		folder + "status.json": statusJSON(t, terraformfiles.NewStatus("Widget: unknown resource", nil, time.Now())),
	}}
	_, out := run(t, request(projectID, diagramID), bucket, nil)
	if out.Data.Files["main.tf"] != "last good" {
		t.Fatalf("files: %v", out.Data.Files)
	}
	if out.Data.Status == nil || out.Data.Status.State != terraformfiles.StateFailed || out.Data.Status.Error != "Widget: unknown resource" {
		t.Fatalf("status: %+v", out.Data.Status)
	}
	if !out.Data.Current {
		t.Fatal("the failed run covers the latest save")
	}
}

func TestAnIncompleteUploadReachesTheEditor(t *testing.T) {
	status := terraformfiles.NewStatus("could not store", nil, time.Now())
	status.FilesIncomplete = true
	bucket := &fakeBucket{objects: map[string]string{
		folder + "main.tf":     "mixed",
		folder + "status.json": statusJSON(t, status),
	}}
	_, out := run(t, request(projectID, diagramID), bucket, nil)
	if out.Data.Status == nil || !out.Data.Status.FilesIncomplete {
		t.Fatalf("status: %+v", out.Data.Status)
	}
}

func TestFilesFromBeforeTheStatusFileAreStillReturned(t *testing.T) {
	bucket := &fakeBucket{objects: map[string]string{folder + "main.tf": "main"}}
	_, out := run(t, request(projectID, diagramID), bucket, nil)
	if !out.Data.Generated || out.Data.Current || out.Data.Status != nil || out.Data.Files["main.tf"] != "main" {
		t.Fatalf("data: %+v", out.Data)
	}
}

func TestAnUnreadableStatusDoesNotHideTheFiles(t *testing.T) {
	bucket := &fakeBucket{objects: map[string]string{folder + "main.tf": "main", folder + "status.json": "{not json"}}
	code, out := run(t, request(projectID, diagramID), bucket, nil)
	if code != http.StatusOK || out.Data.Status != nil || out.Data.Files["main.tf"] != "main" {
		t.Fatalf("status %d data %+v", code, out.Data)
	}
}

func TestAFileDeletedAfterTheListingIsSkipped(t *testing.T) {
	bucket := &fakeBucket{
		objects: map[string]string{folder + "main.tf": "main", folder + "outputs.tf": "outputs"},
		gone:    map[string]bool{folder + "outputs.tf": true},
	}
	code, out := run(t, request(projectID, diagramID), bucket, nil)
	if code != http.StatusOK || len(out.Data.Files) != 1 {
		t.Fatalf("status %d files %v", code, out.Data.Files)
	}
}

func TestTheSizeIsBounded(t *testing.T) {
	big := strings.Repeat("a", 1<<20+1)
	many := map[string]string{}
	for _, name := range strings.Split("abcdefghijklmnopqrstuvwxyzABCDEFGH", "") {
		many[folder+name+".tf"] = "x"
	}
	total := map[string]string{}
	for _, name := range []string{"a", "b", "c", "d", "e"} {
		total[folder+name+".tf"] = strings.Repeat("a", 1<<20)
	}
	for name, bucket := range map[string]*fakeBucket{
		"one large file": {objects: map[string]string{folder + "main.tf": big}},
		"too many files": {objects: many},
		"too much text":  {objects: total},
		"a long listing": {objects: map[string]string{folder + "main.tf": "x"}, truncated: true},
	} {
		t.Run(name, func(t *testing.T) {
			code, out := run(t, request(projectID, diagramID), bucket, nil)
			if code != http.StatusRequestEntityTooLarge || out.Data.Files != nil {
				t.Fatalf("status %d files %d", code, len(out.Data.Files))
			}
			if len(bucket.reads) != 0 {
				t.Fatalf("read %d objects past the limit", len(bucket.reads))
			}
		})
	}
}

func TestAnOutsiderGets404AndTheBucketIsNeverRead(t *testing.T) {
	mock, err := pgxmock.NewConn()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close(context.Background())
	mock.ExpectQuery(`FROM diagrams d`).WithArgs(diagramID, projectID, userID).WillReturnError(pgx.ErrNoRows)

	bucket := &fakeBucket{objects: map[string]string{folder + "main.tf": "secret"}, listErr: errors.New("must not be called")}
	code, out := handle(t, request(projectID, diagramID), mock, bucket)
	if code != http.StatusNotFound {
		t.Fatalf("status %d", code)
	}
	if out.Data.Files != nil {
		t.Fatalf("files: %v", out.Data.Files)
	}
}

func TestErrorsNeverEchoTheCause(t *testing.T) {
	mock, err := pgxmock.NewConn()
	if err != nil {
		t.Fatal(err)
	}
	defer mock.Close(context.Background())
	mock.ExpectQuery(`FROM diagrams d`).WithArgs(diagramID, projectID, userID).
		WillReturnError(errors.New("postgres://user:password@host"))
	code, out := handle(t, request(projectID, diagramID), mock, &fakeBucket{})
	if code != http.StatusInternalServerError || strings.Contains(out.Message, "password") {
		t.Fatalf("status %d message %q", code, out.Message)
	}

	listErr := errors.New("bucket internal detail")
	code, out = run(t, request(projectID, diagramID), &fakeBucket{listErr: listErr}, nil)
	if code != http.StatusInternalServerError || strings.Contains(out.Message, "detail") {
		t.Fatalf("status %d message %q", code, out.Message)
	}
}

func TestBadRequestsNeverReachTheDatabase(t *testing.T) {
	for name, tc := range map[string]struct {
		project, diagram string
	}{
		"missing project": {"", diagramID},
		"missing diagram": {projectID, ""},
		"not a uuid":      {"../other", diagramID},
		"path in the id":  {projectID, diagramID + "/../x"},
		"not a version 4": {"11111111-1111-1111-8111-111111111111", diagramID},
	} {
		t.Run(name, func(t *testing.T) {
			res, err := terraformfiles.Handle(context.Background(), request(tc.project, tc.diagram), terraformfiles.Deps{
				Bucket: "bucket",
				Connect: func(context.Context) (terraformfiles.Database, func(), error) {
					t.Fatal("reached the database")
					return nil, nil, nil
				},
			})
			if err != nil || res.StatusCode != http.StatusBadRequest {
				t.Fatalf("status %d err %v", res.StatusCode, err)
			}
		})
	}
}

func TestNoAuthorizerContextIs401(t *testing.T) {
	req := request(projectID, diagramID)
	req.RequestContext.Authorizer = nil
	res, err := terraformfiles.Handle(context.Background(), req, terraformfiles.Deps{Bucket: "bucket"})
	if err != nil || res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status %d err %v", res.StatusCode, err)
	}
}

func TestAnUppercaseIDUsesTheCanonicalFolder(t *testing.T) {
	bucket := &fakeBucket{objects: map[string]string{folder + "main.tf": "main"}}
	upper := strings.ToUpper(diagramID)
	code, out := run(t, request(projectID, upper), bucket, nil)
	if code != http.StatusOK || out.Data.Files["main.tf"] != "main" {
		t.Fatalf("status %d files %v", code, out.Data.Files)
	}
}
