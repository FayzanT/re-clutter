package writer

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/Alberta2514640/clutter/backend/api/generic/terraformfiles"
	"github.com/Alberta2514640/clutter/backend/api/terraform-engine/create/internal"
)

const folder = "org/project/diagram/terraform/"

// fakeStore is a bucket in memory. No test here reaches S3.
type fakeStore struct {
	objects   map[string]string
	deleteErr error
	getErr    error
	putErrs   map[string]error // by key
	hangOn    string           // a key whose upload runs until its context ends
	puts      int
}

func (f *fakeStore) GetObject(_ context.Context, in *s3.GetObjectInput, _ ...func(*s3.Options)) (*s3.GetObjectOutput, error) {
	if f.getErr != nil {
		return nil, f.getErr
	}
	body, ok := f.objects[aws.ToString(in.Key)]
	if !ok {
		return nil, &types.NoSuchKey{}
	}
	return &s3.GetObjectOutput{Body: io.NopCloser(strings.NewReader(body))}, nil
}

func (f *fakeStore) PutObject(ctx context.Context, in *s3.PutObjectInput, _ ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
	f.puts++
	if aws.ToString(in.Key) == f.hangOn {
		<-ctx.Done()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := f.putErrs[aws.ToString(in.Key)]; err != nil {
		return nil, err
	}
	body, err := io.ReadAll(in.Body)
	if err != nil {
		return nil, err
	}
	f.objects[aws.ToString(in.Key)] = string(body)
	return &s3.PutObjectOutput{}, nil
}

func (f *fakeStore) DeleteObject(_ context.Context, in *s3.DeleteObjectInput, _ ...func(*s3.Options)) (*s3.DeleteObjectOutput, error) {
	if f.deleteErr != nil {
		return nil, f.deleteErr
	}
	delete(f.objects, aws.ToString(in.Key))
	return &s3.DeleteObjectOutput{}, nil
}

func newWriter(objects map[string]string) (*TerraformWriter, *fakeStore) {
	store := &fakeStore{objects: objects}
	return &TerraformWriter{s3Client: store, bucketName: "bucket"}, store
}

func generated(outputs string) *internal.GeneratedTerraform {
	return &internal.GeneratedTerraform{OrgID: "org", ProjectID: "project", DiagramID: "diagram", MainTF: "main", OutputsTF: outputs}
}

func TestWriteToS3WritesBothFiles(t *testing.T) {
	w, store := newWriter(map[string]string{})
	if err := w.WriteToS3(context.Background(), generated("outputs")); err != nil {
		t.Fatal(err)
	}
	if store.objects[folder+"main.tf"] != "main" || store.objects[folder+"outputs.tf"] != "outputs" {
		t.Fatalf("objects: %v", store.objects)
	}
}

func TestWriteToS3DeletesAStaleFileWhenItsContentIsEmpty(t *testing.T) {
	w, store := newWriter(map[string]string{
		folder + "main.tf":           "old main",
		folder + "outputs.tf":        "old outputs",
		folder + "terraform.tfstate": "state",
	})
	if err := w.WriteToS3(context.Background(), generated("")); err != nil {
		t.Fatal(err)
	}
	if _, ok := store.objects[folder+"outputs.tf"]; ok {
		t.Fatal("the previous run's outputs.tf is still there")
	}
	if store.objects[folder+"main.tf"] != "main" {
		t.Fatalf("main.tf: %q", store.objects[folder+"main.tf"])
	}
	if store.objects[folder+"terraform.tfstate"] != "state" {
		t.Fatal("the runner's state must not be touched")
	}
}

func TestWriteToS3ReportsAFailedDelete(t *testing.T) {
	w, store := newWriter(map[string]string{})
	store.deleteErr = errors.New("access denied")
	err := w.WriteToS3(context.Background(), generated(""))
	if err == nil || !strings.Contains(err.Error(), "outputs.tf") {
		t.Fatalf("err: %v", err)
	}
}

func TestWriteToS3RefusesMissingIDs(t *testing.T) {
	w, store := newWriter(map[string]string{folder + "outputs.tf": "old"})
	if err := w.WriteToS3(context.Background(), &internal.GeneratedTerraform{MainTF: "main"}); err == nil {
		t.Fatal("want an error for missing ids")
	}
	if len(store.objects) != 1 {
		t.Fatalf("objects changed: %v", store.objects)
	}
}

func TestWriteStatusRecordsSuccessBesideTheFiles(t *testing.T) {
	w, store := newWriter(map[string]string{})
	saved := "2026-11-04T10:00:00+00:00"
	now := time.Date(2026, 11, 4, 3, 0, 1, 0, time.FixedZone("MST", -7*60*60))
	status := terraformfiles.NewStatus("", &saved, now)
	if err := w.WriteStatus(context.Background(), "org", "project", "diagram", status); err != nil {
		t.Fatal(err)
	}
	var got terraformfiles.Status
	if err := json.Unmarshal([]byte(store.objects[folder+terraformfiles.StatusFile]), &got); err != nil {
		t.Fatal(err)
	}
	want := terraformfiles.Status{State: "success", FinishedAt: "2026-11-04T10:00:01Z", DiagramUpdatedAt: saved}
	if got != want {
		t.Fatalf("status: %+v", got)
	}
}

func TestWriteStatusForAFailedRunLeavesTheFilesAlone(t *testing.T) {
	files := map[string]string{folder + "main.tf": "last good main", folder + "outputs.tf": "last good outputs"}
	w, store := newWriter(files)
	status := terraformfiles.NewStatus("Widget: unknown resource", nil, time.Now())
	if err := w.WriteStatus(context.Background(), "org", "project", "diagram", status); err != nil {
		t.Fatal(err)
	}
	if store.objects[folder+"main.tf"] != "last good main" || store.objects[folder+"outputs.tf"] != "last good outputs" {
		t.Fatalf("a failed run changed the files: %v", store.objects)
	}
	var got terraformfiles.Status
	if err := json.Unmarshal([]byte(store.objects[folder+terraformfiles.StatusFile]), &got); err != nil {
		t.Fatal(err)
	}
	if got.State != "failed" || got.Error != "Widget: unknown resource" {
		t.Fatalf("status: %+v", got)
	}
}

func readStatus(t *testing.T, store *fakeStore) terraformfiles.Status {
	t.Helper()
	var got terraformfiles.Status
	if err := json.Unmarshal([]byte(store.objects[folder+terraformfiles.StatusFile]), &got); err != nil {
		t.Fatal(err)
	}
	return got
}

// The upload order is random, so each file takes its turn as the one that fails.
func TestPublishSaysTheFilesMayBeIncompleteWhenAnUploadFails(t *testing.T) {
	for _, name := range []string{"main.tf", "outputs.tf"} {
		t.Run(name, func(t *testing.T) {
			w, store := newWriter(map[string]string{folder + "main.tf": "old main", folder + "outputs.tf": "old outputs"})
			cause := errors.New("AccessDenied: arn:aws:s3:::bucket")
			store.putErrs = map[string]error{folder + name: cause}

			err := w.Publish(context.Background(), generated("outputs"), nil)
			if !errors.Is(err, cause) {
				t.Fatalf("err: %v", err)
			}
			got := readStatus(t, store)
			if got.State != terraformfiles.StateFailed || !got.FilesIncomplete {
				t.Fatalf("status: %+v", got)
			}
			if !strings.Contains(got.Error, "may be incomplete") || strings.Contains(got.Error, "AccessDenied") {
				t.Fatalf("error: %q", got.Error)
			}
		})
	}
}

// S3 retries can run an upload to the Lambda's deadline. The status must still
// get through, or the run that most needs one records nothing.
func TestPublishRecordsAnUploadThatRunsOutOfTime(t *testing.T) {
	w, store := newWriter(map[string]string{})
	store.hangOn = folder + "outputs.tf"
	ctx, cancel := context.WithTimeout(context.Background(), statusReserve+200*time.Millisecond)
	defer cancel()

	if err := w.Publish(ctx, generated("outputs"), nil); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err: %v", err)
	}
	if got := readStatus(t, store); !got.FilesIncomplete {
		t.Fatalf("status: %+v", got)
	}
}

func TestPublishReportsTheUploadFailureWhenTheStatusAlsoFails(t *testing.T) {
	w, store := newWriter(map[string]string{})
	cause := errors.New("upload refused")
	store.putErrs = map[string]error{
		folder + "main.tf":                 cause,
		folder + terraformfiles.StatusFile: errors.New("status refused"),
	}
	if err := w.Publish(context.Background(), generated("outputs"), nil); !errors.Is(err, cause) {
		t.Fatalf("err: %v", err)
	}
}

func TestPublishRecordsSuccessAfterTheFiles(t *testing.T) {
	w, store := newWriter(map[string]string{})
	saved := "2026-11-04T10:00:00+00:00"
	if err := w.Publish(context.Background(), generated("outputs"), &saved); err != nil {
		t.Fatal(err)
	}
	got := readStatus(t, store)
	if got.State != terraformfiles.StateSuccess || got.FilesIncomplete || got.DiagramUpdatedAt != saved {
		t.Fatalf("status: %+v", got)
	}
}

func TestPublishSucceedsWhenOnlyTheStatusCannotBeWritten(t *testing.T) {
	w, store := newWriter(map[string]string{})
	store.putErrs = map[string]error{folder + terraformfiles.StatusFile: errors.New("status refused")}
	if err := w.Publish(context.Background(), generated("outputs"), nil); err != nil {
		t.Fatalf("a failed status write turned a good run into: %v", err)
	}
	if store.objects[folder+"main.tf"] != "main" || store.objects[folder+"outputs.tf"] != "outputs" {
		t.Fatalf("objects: %v", store.objects)
	}
}

func TestASuccessfulPublishClearsIncompleteFiles(t *testing.T) {
	w, store := newWriter(map[string]string{})
	store.putErrs = map[string]error{folder + "outputs.tf": errors.New("refused")}
	if err := w.Publish(context.Background(), generated("outputs"), nil); err == nil {
		t.Fatal("want the upload error")
	}
	store.putErrs = nil
	if err := w.Publish(context.Background(), generated("outputs"), nil); err != nil {
		t.Fatal(err)
	}
	if readStatus(t, store).FilesIncomplete {
		t.Fatal("a finished upload must clear the flag")
	}
}

func TestRecordFailureKeepsFilesMarkedIncomplete(t *testing.T) {
	w, store := newWriter(map[string]string{})
	store.putErrs = map[string]error{folder + "outputs.tf": errors.New("refused")}
	if err := w.Publish(context.Background(), generated("outputs"), nil); err == nil {
		t.Fatal("want the upload error")
	}
	store.putErrs = nil
	if err := w.RecordFailure(context.Background(), "org", "project", "diagram", "Widget: unknown resource", nil); err != nil {
		t.Fatal(err)
	}
	got := readStatus(t, store)
	if got.Error != "Widget: unknown resource" || !got.FilesIncomplete {
		t.Fatalf("status: %+v", got)
	}
}

func TestRecordFailureOnCompleteFilesDoesNotMarkThem(t *testing.T) {
	for name, getErr := range map[string]error{
		"no earlier status":          nil,
		"earlier status not allowed": errors.New("AccessDenied"),
	} {
		t.Run(name, func(t *testing.T) {
			w, store := newWriter(map[string]string{folder + "main.tf": "last good"})
			store.getErr = getErr
			if err := w.RecordFailure(context.Background(), "org", "project", "diagram", "Widget: unknown resource", nil); err != nil {
				t.Fatal(err)
			}
			if got := readStatus(t, store); got.State != terraformfiles.StateFailed || got.FilesIncomplete {
				t.Fatalf("status: %+v", got)
			}
		})
	}
}

func TestWriteStatusRefusesMissingIDs(t *testing.T) {
	status := terraformfiles.NewStatus("", nil, time.Now())
	for name, ids := range map[string][3]string{
		"diagram": {"org", "project", ""},
		"project": {"org", "", "diagram"},
		"org":     {"", "project", "diagram"},
	} {
		t.Run(name, func(t *testing.T) {
			w, store := newWriter(map[string]string{})
			if err := w.WriteStatus(context.Background(), ids[0], ids[1], ids[2], status); err == nil {
				t.Fatal("want an error for a missing id")
			}
			if store.puts != 0 {
				t.Fatalf("objects: %v", store.objects)
			}
		})
	}
}

func TestFailureRecordingWritesNothingForAnEmptyDiagramID(t *testing.T) {
	w, store := newWriter(map[string]string{})
	if err := w.RecordFailure(context.Background(), "org", "project", "", "failed", nil); err == nil {
		t.Fatal("want an error for a missing id")
	}
	missing := generated("outputs")
	missing.DiagramID = ""
	if err := w.Publish(context.Background(), missing, nil); err == nil {
		t.Fatal("want an error for a missing id")
	}
	if store.puts != 0 {
		t.Fatalf("objects: %v", store.objects)
	}
}
