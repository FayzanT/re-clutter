package gateway

import (
	"encoding/xml"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// realS3Module is the platform Terraform's s3 module, read from the repo.
const realS3Module = "../../../infra/modules/s3"

func endpoint(t *testing.T, s3ModuleDir string) (*NoAWS, *httptest.Server, string) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "s3")
	s3, err := NewLocalS3(dir, s3ModuleDir, log.New(io.Discard, "", 0))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s3.Close() })
	n := NewNoAWS(log.New(io.Discard, "", 0), s3)
	srv := httptest.NewServer(n)
	t.Cleanup(srv.Close)
	return n, srv, dir
}

func request(t *testing.T, method, url, body string, headers map[string]string) (*http.Response, string) {
	t.Helper()
	req, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	return res, string(b)
}

func TestObjectRoundTrip(t *testing.T) {
	_, srv, dir := endpoint(t, realS3Module)
	url := srv.URL + "/" + LocalDataBucket + "/org/proj/dia/terraform/main.tf"

	// The presigned query and a signature that could never verify.
	res, _ := request(t, "PUT", url+"?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=bad&x-id=PutObject", "resource {}", nil)
	if res.StatusCode != 200 || res.Header.Get("ETag") == "" {
		t.Fatalf("put: %d %v", res.StatusCode, res.Header)
	}
	onDisk, err := os.ReadFile(filepath.Join(dir, LocalDataBucket, "org/proj/dia/terraform/main.tf"))
	if err != nil || string(onDisk) != "resource {}" {
		t.Fatalf("on disk: %q %v", onDisk, err)
	}

	res, body := request(t, "GET", url+"?x-id=GetObject", "", nil)
	if res.StatusCode != 200 || body != "resource {}" {
		t.Fatalf("get: %d %q", res.StatusCode, body)
	}
	etag := res.Header.Get("ETag")
	res, _ = request(t, "HEAD", url, "", nil)
	if res.StatusCode != 200 || res.ContentLength != 11 || res.Header.Get("ETag") != etag {
		t.Fatalf("head: %d %d %v", res.StatusCode, res.ContentLength, res.Header)
	}

	if res, _ = request(t, "DELETE", url+"?x-id=DeleteObject", "", nil); res.StatusCode != 204 {
		t.Fatalf("delete: %d", res.StatusCode)
	}
	if res, _ = request(t, "DELETE", url, "", nil); res.StatusCode != 204 {
		t.Fatalf("second delete: %d", res.StatusCode)
	}
	res, body = request(t, "GET", url, "", nil)
	if res.StatusCode != 404 || !strings.Contains(body, "<Code>NoSuchKey</Code>") {
		t.Fatalf("get after delete: %d %q", res.StatusCode, body)
	}
	if res, _ = request(t, "HEAD", url, "", nil); res.StatusCode != 404 {
		t.Fatalf("head after delete: %d", res.StatusCode)
	}
}

func TestListObjectsV2(t *testing.T) {
	_, srv, _ := endpoint(t, realS3Module)
	base := srv.URL + "/" + LocalDataBucket
	for _, key := range []string{"a/logs/d1/command.log", "a/logs/d1/init.log", "a/logs/d2/init.log", "a/logs/top.txt", "b/other.txt"} {
		if res, _ := request(t, "PUT", base+"/"+key, "x", nil); res.StatusCode != 200 {
			t.Fatalf("put %s: %d", key, res.StatusCode)
		}
	}
	list := func(query string) listResult {
		t.Helper()
		res, body := request(t, "GET", base+"?list-type=2&"+query, "", nil)
		if res.StatusCode != 200 {
			t.Fatalf("list %s: %d %s", query, res.StatusCode, body)
		}
		var out listResult
		if err := xml.Unmarshal([]byte(body), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}

	got := list("prefix=a/logs/&delimiter=/")
	if len(got.CommonPrefixes) != 2 || got.CommonPrefixes[0].Prefix != "a/logs/d1/" || got.CommonPrefixes[1].Prefix != "a/logs/d2/" {
		t.Errorf("common prefixes: %+v", got.CommonPrefixes)
	}
	if len(got.Contents) != 1 || got.Contents[0].Key != "a/logs/top.txt" || got.KeyCount != 3 {
		t.Errorf("contents: %+v, key count %d", got.Contents, got.KeyCount)
	}
	if got := list("prefix=a/logs/d1/"); len(got.Contents) != 2 || got.IsTruncated {
		t.Errorf("flat list: %+v", got)
	}

	// Paging visits every key once, including past a common prefix.
	var seen []string
	token := ""
	for range 10 {
		page := list("max-keys=1&delimiter=/&prefix=a/logs/&continuation-token=" + token)
		for _, p := range page.CommonPrefixes {
			seen = append(seen, p.Prefix)
		}
		for _, c := range page.Contents {
			seen = append(seen, c.Key)
		}
		if !page.IsTruncated {
			break
		}
		token = page.NextContinuationToken
	}
	if strings.Join(seen, " ") != "a/logs/d1/ a/logs/d2/ a/logs/top.txt" {
		t.Errorf("paged: %v", seen)
	}
}

func TestKeysCannotLeaveTheBucket(t *testing.T) {
	_, srv, dir := endpoint(t, realS3Module)
	for _, key := range []string{"../../escaped", "a/../../escaped", "a//b", "a/./b", "a/"} {
		// A raw request: the client must not tidy the path first.
		req, err := http.NewRequest("PUT", srv.URL+"/"+LocalDataBucket+"/placeholder", strings.NewReader("x"))
		if err != nil {
			t.Fatal(err)
		}
		req.URL.Path = "/" + LocalDataBucket + "/" + key
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 400 {
			t.Errorf("key %q: got %d", key, res.StatusCode)
		}
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(dir), "escaped")); err == nil {
		t.Fatal("a key wrote outside the store")
	}
}

func TestChunkedUploadIsRefusedNotStored(t *testing.T) {
	_, srv, dir := endpoint(t, realS3Module)
	res, _ := request(t, "PUT", srv.URL+"/"+LocalDataBucket+"/k", "5;chunk-signature=x\r\nhello\r\n0\r\n\r\n",
		map[string]string{"X-Amz-Content-Sha256": "STREAMING-AWS4-HMAC-SHA256-PAYLOAD"})
	if res.StatusCode != 501 {
		t.Fatalf("got %d", res.StatusCode)
	}
	if _, err := os.Stat(filepath.Join(dir, LocalDataBucket, "k")); err == nil {
		t.Fatal("stored a framed body")
	}
}

func TestEverythingElseStaysRefused(t *testing.T) {
	n, srv, _ := endpoint(t, realS3Module)
	cases := []struct {
		name, method, path, body string
		headers                  map[string]string
		want                     string
	}{
		{"ECS", "POST", "/", "{}", map[string]string{"X-Amz-Target": "AmazonEC2ContainerServiceV20141113.RunTask", "Content-Type": "application/x-amz-json-1.1"}, "AmazonEC2ContainerServiceV20141113.RunTask"},
		{"SQS", "POST", "/", "{}", map[string]string{"X-Amz-Target": "AmazonSQS.SendMessage", "Content-Type": "application/x-amz-json-1.0"}, "AmazonSQS.SendMessage"},
		{"CloudWatch Logs", "POST", "/", "{}", map[string]string{"X-Amz-Target": "Logs_20140328.GetLogEvents", "Content-Type": "application/x-amz-json-1.1"}, "Logs_20140328.GetLogEvents"},
		{"STS", "POST", "/", "Action=GetCallerIdentity", map[string]string{"Content-Type": "application/x-www-form-urlencoded"}, "S3 POST "},
		{"unknown bucket", "GET", "/someone-elses-bucket/key", "", nil, "S3 GET someone-elses-bucket"},
		{"S3 POST", "POST", "/" + LocalDataBucket + "/k", "", nil, "S3 POST " + LocalDataBucket},
		{"sub-resource", "GET", "/" + LocalDataBucket + "/k?tagging", "", nil, "S3 GET " + LocalDataBucket},
		{"bucket call", "HEAD", "/" + LocalDataBucket, "", nil, "S3 HEAD " + LocalDataBucket},
	}
	for _, c := range cases {
		res, _ := request(t, c.method, srv.URL+c.path, c.body, c.headers)
		if res.StatusCode != 403 {
			t.Errorf("%s: got %d", c.name, res.StatusCode)
		}
		if len(n.calls) == 0 || n.calls[len(n.calls)-1] != c.want {
			t.Errorf("%s: recorded %v, want %q", c.name, n.calls, c.want)
		}
	}
}

func TestBrowserCORS(t *testing.T) {
	_, srv, _ := endpoint(t, realS3Module)
	url := srv.URL + "/" + LocalDataBucket + "/org/code/bootstrap.zip"
	preflight := func(origin string) *http.Response {
		res, _ := request(t, "OPTIONS", url, "", map[string]string{
			"Origin":                         origin,
			"Access-Control-Request-Method":  "PUT",
			"Access-Control-Request-Headers": "content-type,x-amz-server-side-encryption",
		})
		return res
	}

	res := preflight("http://localhost:3000")
	if res.StatusCode != 200 || res.Header.Get("Access-Control-Allow-Origin") != "http://localhost:3000" ||
		!strings.Contains(res.Header.Get("Access-Control-Allow-Methods"), "PUT") ||
		res.Header.Get("Access-Control-Allow-Headers") != "content-type,x-amz-server-side-encryption" {
		t.Fatalf("preflight: %d %v", res.StatusCode, res.Header)
	}
	res = preflight("https://evil.example")
	if res.StatusCode != 403 || res.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("foreign origin: %d %v", res.StatusCode, res.Header)
	}

	res, _ = request(t, "PUT", url, "zip", map[string]string{"Origin": "http://localhost:3000", "x-amz-server-side-encryption": "AES256"})
	if res.StatusCode != 200 || res.Header.Get("Access-Control-Allow-Origin") != "http://localhost:3000" {
		t.Fatalf("put: %d %v", res.StatusCode, res.Header)
	}
	res, body := request(t, "GET", url, "", map[string]string{"Origin": "http://localhost:3000"})
	if res.StatusCode != 200 || body != "zip" || !strings.Contains(res.Header.Get("Access-Control-Expose-Headers"), "ETag") {
		t.Fatalf("get: %d %q %v", res.StatusCode, body, res.Header)
	}
}

// TestEveryS3ObjectHasASource fails when an aws_s3_object in the platform
// Terraform has no file behind it, or a template the generator asks for is not
// in the mapping.
func TestEveryS3ObjectHasASource(t *testing.T) {
	objects, err := TemplateObjects(realS3Module)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(realS3Module, "main.tf"))
	if err != nil {
		t.Fatal(err)
	}
	if want := strings.Count(string(raw), `resource "aws_s3_object"`); len(objects) != want {
		t.Errorf("main.tf has %d aws_s3_object blocks, resolved %d", want, len(objects))
	}
	for _, kind := range []string{"apigateway", "dynamodb", "ec2", "lambda", "s3"} {
		for _, file := range []string{"main.tf.tmpl", "outputs.tf.tmpl"} {
			if _, ok := objects["templates/aws/"+kind+"/"+file]; !ok {
				t.Errorf("no object for templates/aws/%s/%s", kind, file)
			}
		}
	}
}

func writeModule(t *testing.T, mainTF string, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "main.tf"), []byte(mainTF), 0o600); err != nil {
		t.Fatal(err)
	}
	for name, content := range files {
		p := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

const oneObject = `resource "aws_s3_object" "t" {

  bucket = aws_s3_bucket.templates.id

  key    = "templates/aws/x/main.tf.tmpl"
  source = "${path.module}/uploads/aws/x/main.tf.tmpl"
}
`

func TestUnresolvableObjectsAreErrors(t *testing.T) {
	cases := map[string]string{
		"missing source": oneObject,
		"computed key":   strings.Replace(oneObject, `"templates/aws/x/main.tf.tmpl"`, `"${var.prefix}/main.tf.tmpl"`, 1),
		"other bucket":   strings.Replace(oneObject, "aws_s3_bucket.templates.id", "aws_s3_bucket.clutter_bucket.id", 1),
		"unparsed block": oneObject + `resource  "aws_s3_object" "u" {}` + "\n",
	}
	files := map[string]map[string]string{
		"computed key":   {"uploads/aws/x/main.tf.tmpl": "x"},
		"other bucket":   {"uploads/aws/x/main.tf.tmpl": "x"},
		"unparsed block": {"uploads/aws/x/main.tf.tmpl": "x"},
	}
	for name, tf := range cases {
		if _, err := TemplateObjects(writeModule(t, tf, files[name])); err == nil {
			t.Errorf("%s: no error", name)
		}
	}
	if _, err := TemplateObjects(writeModule(t, "# no objects\n", nil)); err == nil {
		t.Error("an s3 module with no objects: no error")
	}
}

func TestTemplatesComeLiveFromTheRepoAndAreReadOnly(t *testing.T) {
	module := writeModule(t, oneObject, map[string]string{"uploads/aws/x/main.tf.tmpl": "first"})
	_, srv, _ := endpoint(t, module)
	url := srv.URL + "/" + LocalTemplateBucket + "/templates/aws/x/main.tf.tmpl"

	if res, body := request(t, "GET", url, "", nil); res.StatusCode != 200 || body != "first" {
		t.Fatalf("get: %d %q", res.StatusCode, body)
	}
	if err := os.WriteFile(filepath.Join(module, "uploads/aws/x/main.tf.tmpl"), []byte("edited"), 0o600); err != nil {
		t.Fatal(err)
	}
	if res, body := request(t, "GET", url, "", nil); res.StatusCode != 200 || body != "edited" {
		t.Fatalf("edit not visible: %d %q", res.StatusCode, body)
	}
	res, body := request(t, "GET", srv.URL+"/"+LocalTemplateBucket+"?list-type=2&prefix=templates/aws/", "", nil)
	if res.StatusCode != 200 || !strings.Contains(body, "<Key>templates/aws/x/main.tf.tmpl</Key>") {
		t.Fatalf("list: %d %s", res.StatusCode, body)
	}
	if res, _ := request(t, "GET", srv.URL+"/"+LocalTemplateBucket+"/uploads/aws/x/main.tf.tmpl", "", nil); res.StatusCode != 404 {
		t.Fatalf("a path outside the mapping: %d", res.StatusCode)
	}
	if res, _ := request(t, "PUT", url, "x", nil); res.StatusCode != 403 {
		t.Fatalf("put: %d", res.StatusCode)
	}
	if res, _ := request(t, "DELETE", url, "", nil); res.StatusCode != 403 {
		t.Fatalf("delete: %d", res.StatusCode)
	}
}
