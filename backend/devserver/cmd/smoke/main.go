// Command smoke drives every API route through the devserver gateway in the
// order a person would use the app, and prints one row per call.
//
// Verdicts:
//
//	PASS       the route did its job against the local Postgres and local S3
//	NEEDS-AWS  the route got past its database, auth and S3 steps and stopped
//	           at an AWS call the devserver refuses (ECS, SQS; expected)
//	EXPECTED   a refusal that is correct offline, named in the reason
//	FAIL       anything else
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/Alberta2514640/clutter/backend/devserver/internal/devauth"
	"github.com/Alberta2514640/clutter/backend/devserver/internal/gateway"
	"github.com/Alberta2514640/clutter/backend/devserver/internal/routes"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type expect int

const (
	expectOK expect = iota
	expectAWS
	expectStatus
)

type row struct {
	route   string
	status  int
	verdict string
	reason  string
}

// check is one assertion outside the 31 route rows.
type check struct {
	name string
	ok   bool
	note string
}

type runner struct {
	api    string
	token  string
	client *http.Client
	rows   []row
	hit    map[string]bool
	checks []check
}

type resp struct {
	status int
	body   []byte
	header http.Header
	json   map[string]any
}

func (r *runner) do(method, path string, body any, auth string) resp {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, r.api+path, rd)
	req.Header.Set("Content-Type", "application/json")
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	res, err := r.client.Do(req)
	if err != nil {
		return resp{status: 0, body: []byte(err.Error())}
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	out := resp{status: res.StatusCode, body: b, header: res.Header}
	_ = json.Unmarshal(b, &out.json)
	return out
}

// summary pulls a one-line reason out of a response body.
func summary(rs resp) string {
	parts := []string{}
	for _, k := range []string{"message", "Message", "error", "details"} {
		if v, ok := rs.json[k]; ok && v != nil {
			s := fmt.Sprint(v)
			if s != "" && !contains(parts, s) {
				parts = append(parts, s)
			}
		}
	}
	if len(parts) == 0 {
		parts = append(parts, strings.TrimSpace(string(rs.body)))
	}
	s := strings.Join(parts, ": ")
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > 110 {
		s = s[:107] + "..."
	}
	return s
}

func dedupe(xs []string) []string {
	var out []string
	for _, x := range xs {
		if !contains(out, x) {
			out = append(out, x)
		}
	}
	return out
}

func contains(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}

// routeKey maps a concrete call to its route-table entry, for coverage.
func routeKey(method, path string) string {
	p := path
	if i := strings.IndexByte(p, '?'); i >= 0 {
		p = p[:i]
	}
	segs := strings.Split(strings.Trim(p, "/"), "/")
	best, bestLit := "", -1
	for _, rt := range routes.Routes {
		if rt.Method != method {
			continue
		}
		rs := strings.Split(strings.Trim(rt.Path, "/"), "/")
		if len(rs) != len(segs) {
			continue
		}
		lit, ok := 0, true
		for i := range rs {
			if strings.HasPrefix(rs[i], "{") {
				continue
			}
			if rs[i] != segs[i] {
				ok = false
				break
			}
			lit++
		}
		if ok && lit > bestLit {
			best, bestLit = rt.Method+" "+rt.Path, lit
		}
	}
	return best
}

// call runs one step and records its row. check may add a data assertion to a
// 2xx answer; it returns "" when the data is right.
// awsCalls returns the AWS calls the gateway refused after index since.
func (r *runner) awsCalls(since int) (int, []string) {
	rs := r.do("GET", fmt.Sprintf("/dev/aws-calls?since=%d", since), nil, "")
	var out struct {
		Next  int      `json:"next"`
		Calls []string `json:"calls"`
	}
	_ = json.Unmarshal(rs.body, &out)
	return out.Next, out.Calls
}

func (r *runner) call(method, path string, body any, ex expect, wantStatus int, why string, check func(resp) string) resp {
	before, _ := r.awsCalls(1 << 30)
	rs := r.do(method, path, body, r.token)
	_, refused := r.awsCalls(before)
	key := routeKey(method, path)
	r.hit[key] = true
	rw := row{route: key, status: rs.status}
	switch ex {
	case expectOK:
		if rs.status >= 200 && rs.status < 300 {
			rw.verdict, rw.reason = "PASS", summary(rs)
			if check != nil {
				if msg := check(rs); msg != "" {
					rw.verdict, rw.reason = "FAIL", msg
				}
			}
		} else {
			rw.verdict, rw.reason = "FAIL", summary(rs)
		}
	case expectAWS:
		switch {
		case rs.status >= 200 && rs.status < 300:
			rw.verdict, rw.reason = "PASS", why
		case len(refused) > 0:
			rw.verdict, rw.reason = "NEEDS-AWS", fmt.Sprintf("%s; refused %s; handler said %q", why, strings.Join(dedupe(refused), ", "), summary(rs))
		default:
			rw.verdict, rw.reason = "FAIL", "no AWS call was attempted: "+summary(rs)
		}
	case expectStatus:
		if rs.status == wantStatus {
			rw.verdict, rw.reason = "EXPECTED", why
		} else {
			rw.verdict, rw.reason = "FAIL", fmt.Sprintf("want %d: %s", wantStatus, summary(rs))
		}
	}
	r.rows = append(r.rows, rw)
	return rs
}

func str(m map[string]any, path ...string) string {
	var cur any = m
	for _, p := range path {
		mm, ok := cur.(map[string]any)
		if !ok {
			return ""
		}
		cur = mm[p]
	}
	s, _ := cur.(string)
	return s
}

func randSuffix() string {
	b := make([]byte, 2)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func main() {
	api := flag.String("api", "http://127.0.0.1:8787", "gateway base URL")
	s3Dir := flag.String("s3-dir", "", "the local S3 store on disk (.state/s3)")
	flag.Parse()
	conn := os.Getenv("PSQL_CONNECTION_STRING")
	if conn == "" || *s3Dir == "" {
		fmt.Fprintln(os.Stderr, "smoke: PSQL_CONNECTION_STRING or -s3-dir is not set (run it through smoke.sh)")
		os.Exit(2)
	}

	r := &runner{api: strings.TrimRight(*api, "/"), client: &http.Client{Timeout: 30 * time.Second}, hit: map[string]bool{}}

	// Dev sign-in (devserver only, not one of the 31 routes).
	login := r.do("GET", "/dev/login?format=json", nil, "")
	if login.status != http.StatusCreated {
		fmt.Fprintf(os.Stderr, "smoke: dev login failed (%d): %s\n", login.status, login.body)
		os.Exit(1)
	}
	r.token = str(login.json, "token")
	userID := str(login.json, "user_data", "uuid")
	fmt.Printf("dev login: %s (%s)\n\n", str(login.json, "user_data", "email"), login.json["message"])

	sfx := randSuffix()

	// 1. Sign-in with Google cannot work offline: the token is checked by Google.
	r.call("POST", "/log-in", map[string]string{"token": "not-a-google-id-token"}, expectStatus, 401,
		"needs a real Google ID token; the handler rejected the fake one", nil)

	r.call("GET", "/user-information", nil, expectOK, 0, "", func(rs resp) string {
		if str(rs.json, "data", "uuid") != userID {
			return "uuid does not match the signed-in user"
		}
		return ""
	})

	// The canvas palette loads this without a token.
	var resources []map[string]any
	r.call("GET", "/resources", nil, expectOK, 0, "", func(rs resp) string {
		raw, _ := json.Marshal(rs.json["data"])
		_ = json.Unmarshal(raw, &resources)
		if len(resources) != 5 {
			return fmt.Sprintf("want 5 seeded resources, got %d", len(resources))
		}
		return ""
	})

	// Onboarding: create an organization, then the dashboard lists it.
	org := r.call("POST", "/organization", map[string]string{
		"organizationName": "Smoke Org " + sfx,
		"description":      "Created by the devserver smoke test",
	}, expectOK, 0, "", nil)
	orgID := str(org.json, "data", "id")
	if orgID == "" {
		fatal(r, "organization create returned no id")
	}
	r.call("GET", "/organization", nil, expectOK, 0, "", func(rs resp) string {
		if !strings.Contains(string(rs.body), orgID) {
			return "new organization missing from the list"
		}
		return ""
	})
	r.call("GET", "/organization?organizationId="+orgID, nil, expectOK, 0, "", nil)
	r.call("PUT", "/organization/"+orgID, map[string]string{"description": "Updated by the devserver smoke test"}, expectOK, 0, "", nil)

	// Link an AWS account: the stack URL, then paste back a role ARN.
	stack := r.call("GET", "/cloudformation-stack-url/"+orgID+"?accountName=smoke"+sfx+"&region=us-west-2", nil, expectOK, 0, "", nil)
	accountID := str(stack.json, "data", "account_id")
	uniqueID := ""
	if u, err := url.Parse(str(stack.json, "data", "url")); err == nil {
		// The URL's query sits after the console's #/ fragment.
		if i := strings.Index(u.Fragment, "?"); i >= 0 {
			q, _ := url.ParseQuery(u.Fragment[i+1:])
			uniqueID = q.Get("param_UniqueId")
		}
		if uniqueID == "" {
			uniqueID = u.Query().Get("param_UniqueId")
		}
	}
	r.call("GET", "/organization/"+orgID+"/accounts", nil, expectOK, 0, "", func(rs resp) string {
		if !strings.Contains(string(rs.body), accountID) {
			return "new account missing from the list"
		}
		return ""
	})
	// A fake ARN that matches the API Gateway model's pattern.
	r.call("POST", "/organization/"+orgID+"/accounts/"+accountID, map[string]string{
		"role_arn": "arn:aws:iam::123456789012:role/AllowClutterToDeployTerraformRole-" + uniqueID,
	}, expectOK, 0, "", nil)

	// Projects.
	proj := r.call("POST", "/project", map[string]string{
		"organizationId": orgID, "name": "Smoke Project", "description": "Created by the devserver smoke test",
	}, expectOK, 0, "", nil)
	projID := str(proj.json, "data", "id")
	if projID == "" {
		fatal(r, "project create returned no id")
	}
	r.call("GET", "/project?organizationId="+orgID, nil, expectOK, 0, "", nil)
	r.call("GET", "/project?organizationId="+orgID+"&projectId="+projID, nil, expectOK, 0, "", nil)
	r.call("PUT", "/project?projectId="+projID, map[string]string{
		"organizationId": orgID, "name": "Smoke Project Renamed", "description": "Renamed by the devserver smoke test",
	}, expectOK, 0, "", nil)

	// Diagrams.
	dia := r.call("POST", "/diagram", map[string]string{"projectId": projID, "name": "Smoke Diagram"}, expectOK, 0, "", nil)
	diaID := str(dia.json, "data", "id")
	if diaID == "" {
		fatal(r, "diagram create returned no id")
	}
	r.call("GET", "/diagram?projectId="+projID, nil, expectOK, 0, "", nil)
	layout := reactFlowLayout(resources)
	r.call("PUT", "/diagram", map[string]any{
		"projectId": projID, "diagramId": diaID, "name": "Smoke Diagram", "data": layout,
	}, expectOK, 0, "", nil)
	// Nothing in this run has called /terraform-engine yet: only the save can
	// have produced these files.
	r.checkGenerated(filepath.Join(*s3Dir, gateway.LocalDataBucket, orgID, projID, diaID, "terraform"))
	r.call("GET", "/diagram?projectId="+projID+"&diagramId="+diaID, nil, expectOK, 0, "", func(rs resp) string {
		var env struct {
			Data json.RawMessage `json:"data"`
		}
		_ = json.Unmarshal(rs.body, &env)
		var one struct {
			Data struct {
				Nodes []any `json:"nodes"`
				Edges []any `json:"edges"`
			} `json:"data"`
		}
		if err := json.Unmarshal(env.Data, &one); err != nil {
			var many []json.RawMessage
			if json.Unmarshal(env.Data, &many) == nil && len(many) > 0 {
				_ = json.Unmarshal(many[0], &one)
			}
		}
		if len(one.Data.Nodes) != 5 || len(one.Data.Edges) != 3 {
			return fmt.Sprintf("saved layout not read back: %d nodes, %d edges", len(one.Data.Nodes), len(one.Data.Edges))
		}
		return ""
	})

	// Lambda code upload: the presigned URL, then the browser's PUT to it.
	upload := r.call("POST", "/terraform-engine/code-upload/presigned-url", map[string]string{
		"org_id": orgID, "project_id": projID, "diagram_id": diaID, "lambda_resource_name": "smoke_fn", "runtime": "python3.13",
	}, expectOK, 0, "", nil)
	uploadURL := str(upload.json, "upload_url")
	r.checkBrowserUpload(uploadURL, str(upload.json, "s3_key"), filepath.Join(*s3Dir, gateway.LocalDataBucket))
	s3Endpoint := ""
	if u, err := url.Parse(uploadURL); err == nil {
		s3Endpoint = u.Scheme + "://" + u.Host + "/" + gateway.LocalDataBucket + "/"
	}

	// Deploy logs are written by the runner, which needs AWS: put one in place.
	logKey := orgID + "/" + projID + "/" + diaID + "/terraform/logs/smoke001/command.log"
	if rs := r.s3Put(s3Endpoint+logKey, "smoke deploy log\n"); rs.status != http.StatusOK {
		fatal(r, "seed the deploy log: "+summary(rs))
	}

	// Deploy: the runner writes its log row, then calls ECS.
	r.call("POST", "/terraform-command-runner", map[string]string{
		"organizationId": orgID, "projectId": projID, "diagramId": diaID, "accountAccessRoleId": accountID, "command": "apply",
	}, expectAWS, 0, "stops at ecs:RunTask after writing a RUNNING deploy-log row", nil)
	r.call("GET", "/terraform-engine/logs/recent-activity?orgId="+orgID+"&diagramId="+diaID, nil, expectOK, 0, "", nil)
	r.call("GET", "/terraform-engine/logs?orgId="+orgID+"&projId="+projID+"&diagramId="+diaID, nil, expectOK, 0, "", func(rs resp) string {
		if !strings.Contains(string(rs.body), "smoke001") || !strings.Contains(string(rs.body), "command.log") {
			return "the seeded deploy log is missing from the list: " + summary(rs)
		}
		return ""
	})
	logURL := r.call("GET", "/terraform-engine/logs/url?orgId="+orgID+"&projId="+projID+"&diagramId="+diaID+"&deploymentId=smoke001&file=command.log", nil, expectOK, 0, "", nil)
	r.checkBrowserDownload(str(logURL.json, "data", "url"), "smoke deploy log\n")
	r.call("GET", "/terraform-engine/logs/live?orgId="+orgID+"&projId="+projID+"&diagramId="+diaID+
		"&taskArn="+url.QueryEscape("arn:aws:ecs:us-west-2:000000000000:task/clutter-devserver-local/0123456789abcdef0123456789abcdef"), nil, expectAWS, 0,
		"stops at ecs:DescribeTasks", nil)

	// Generation, as the Supabase webhook would call it (no token).
	saveTok := r.token
	r.token = ""
	r.call("POST", "/terraform-engine", map[string]any{
		"type": "UPDATE", "table": "diagrams", "schema": "public",
		"record": map[string]any{
			"id": diaID, "name": "Smoke Diagram", "project_id": projID, "created_by": userID,
			"created_at": time.Now().UTC().Format(time.RFC3339), "data": layout,
		},
		"old_record": map[string]any{"id": diaID, "project_id": projID, "data": map[string]any{"nodes": []any{}, "edges": []any{}}},
	}, expectOK, 0, "", func(rs resp) string {
		if !strings.Contains(str(rs.json, "s3_path"), diaID) {
			return "no s3_path for the diagram: " + summary(rs)
		}
		return ""
	})
	r.token = saveTok

	// Ansible: playbook upload URL, the upload, job submit, then job reads.
	pb := r.call("POST", "/ansible/playbooks/upload-url", map[string]string{
		"file_name": "site.yml", "project_id": projID, "diagram_id": diaID,
	}, expectOK, 0, "", nil)
	playbookID := str(pb.json, "data", "playbook_id")
	playbookKey := str(pb.json, "data", "playbook_s3_key")
	if rs := r.s3Put(str(pb.json, "data", "upload_url"), "---\n- hosts: localhost\n  tasks: []\n"); rs.status != http.StatusOK {
		fatal(r, "upload the playbook: "+summary(rs))
	}
	r.call("POST", "/ansible/jobs", map[string]any{
		"account_access_role_id": accountID, "target_instance_ids": []string{"i-0123456789abcdef0"}, "playbook_id": playbookID,
	}, expectAWS, 0, "the playbook checks pass in local S3; stops at sqs:SendMessage and marks the job FAILED", nil)

	// submit-job cannot queue a job offline, so insert a job with a log, as
	// the runner would leave one.
	jobID, jobLogKey, err := insertFixtureJob(conn, userID, orgID, projID, diaID)
	if err != nil {
		fatal(r, "insert fixture job: "+err.Error())
	}
	if rs := r.s3Put(s3Endpoint+jobLogKey, "smoke job log\n"); rs.status != http.StatusOK {
		fatal(r, "seed the job log: "+summary(rs))
	}
	r.call("GET", "/ansible/jobs", nil, expectOK, 0, "", func(rs resp) string {
		if !strings.Contains(string(rs.body), jobID) {
			return "fixture job missing from the list"
		}
		return ""
	})
	r.call("GET", "/ansible/jobs/"+jobID, nil, expectOK, 0, "", nil)
	r.call("GET", "/ansible/jobs/"+jobID+"/logs", nil, expectOK, 0, "", func(rs resp) string {
		if str(rs.json, "data", "log_content") != "smoke job log\n" {
			return "the seeded job log did not come back: " + summary(rs)
		}
		return ""
	})

	// Clean up in reverse.
	r.call("DELETE", "/organization/"+orgID+"/accounts/"+accountID, nil, expectOK, 0, "", nil)
	r.call("DELETE", "/diagram?projectId="+projID+"&diagramId="+diaID, nil, expectOK, 0, "", nil)
	r.call("DELETE", "/project?organizationId="+orgID+"&projectId="+projID, nil, expectOK, 0, "", nil)
	r.call("DELETE", "/organization/"+orgID, nil, expectOK, 0, "", nil)
	if err := deleteFixtureJobs(conn, jobID, playbookKey); err != nil {
		fatal(r, "delete fixture jobs: "+err.Error())
	}
	// The real platform keeps a deleted diagram's files too. Smoke leaves none.
	if err := os.RemoveAll(filepath.Join(*s3Dir, gateway.LocalDataBucket, orgID)); err != nil {
		fatal(r, "remove smoke files: "+err.Error())
	}

	gatewayChecks(r, s3Endpoint)
	report(r)
}

// s3Put uploads to the local S3 the way the frontend does.
func (r *runner) s3Put(target, body string) resp {
	req, err := http.NewRequest("PUT", target, strings.NewReader(body))
	if err != nil {
		return resp{body: []byte(err.Error())}
	}
	req.Header.Set("x-amz-server-side-encryption", "AES256")
	res, err := r.client.Do(req)
	if err != nil {
		return resp{body: []byte(err.Error())}
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return resp{status: res.StatusCode, body: b, header: res.Header}
}

// checkGenerated waits for the background generation after a save and checks
// that both files exist with all five resource types in them.
func (r *runner) checkGenerated(dir string) {
	const name = "PUT /diagram generates main.tf and outputs.tf"
	// Poll for the content, not the files: the diagram's create also generated
	// a main.tf, and the writer may replace the two files in either order.
	problem := ""
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); time.Sleep(100 * time.Millisecond) {
		mainTF, err := os.ReadFile(filepath.Join(dir, "main.tf"))
		if err != nil {
			problem = err.Error()
			continue
		}
		outputsTF, err := os.ReadFile(filepath.Join(dir, "outputs.tf"))
		if err != nil {
			problem = err.Error()
			continue
		}
		problem = ""
		for _, want := range []string{"aws_lambda_function", "aws_s3_bucket", "aws_dynamodb_table", "aws_api_gateway_rest_api", "aws_instance", "aws_iam_policy", "aws_lambda_permission"} {
			if !strings.Contains(string(mainTF), want) {
				problem = "main.tf has no " + want
			}
		}
		if problem == "" && len(outputsTF) > 0 {
			r.checks = append(r.checks, check{name, true, fmt.Sprintf("main.tf %d bytes, outputs.tf %d bytes, all five resource types", len(mainTF), len(outputsTF))})
			return
		}
	}
	r.checks = append(r.checks, check{name, false, problem})
}

// checkBrowserUpload does what the browser does with a presigned URL: a CORS
// preflight, then the PUT, and checks the object reached the disk.
func (r *runner) checkBrowserUpload(target, key, bucketDir string) {
	const name, origin = "presigned PUT from a browser", "http://localhost:3000"
	pre, err := http.NewRequest("OPTIONS", target, nil)
	if err != nil {
		r.checks = append(r.checks, check{name, false, err.Error()})
		return
	}
	pre.Header.Set("Origin", origin)
	pre.Header.Set("Access-Control-Request-Method", "PUT")
	pre.Header.Set("Access-Control-Request-Headers", "content-type,x-amz-server-side-encryption")
	res, err := r.client.Do(pre)
	if err != nil {
		r.checks = append(r.checks, check{name, false, err.Error()})
		return
	}
	res.Body.Close()
	if res.StatusCode != 200 || res.Header.Get("Access-Control-Allow-Origin") != origin {
		r.checks = append(r.checks, check{name, false, fmt.Sprintf("preflight %d, allow-origin %q", res.StatusCode, res.Header.Get("Access-Control-Allow-Origin"))})
		return
	}
	if rs := r.s3Put(target, "smoke zip"); rs.status != http.StatusOK {
		r.checks = append(r.checks, check{name, false, fmt.Sprintf("PUT %d", rs.status)})
		return
	}
	got, err := os.ReadFile(filepath.Join(bucketDir, filepath.FromSlash(key)))
	r.checks = append(r.checks, check{name, err == nil && string(got) == "smoke zip", "preflight 200, PUT 200, object on disk"})
}

// checkBrowserDownload fetches a presigned GET URL from a browser origin.
func (r *runner) checkBrowserDownload(target, want string) {
	const name, origin = "presigned GET from a browser", "http://localhost:3000"
	req, err := http.NewRequest("GET", target, nil)
	if err != nil {
		r.checks = append(r.checks, check{name, false, err.Error()})
		return
	}
	req.Header.Set("Origin", origin)
	res, err := r.client.Do(req)
	if err != nil {
		r.checks = append(r.checks, check{name, false, err.Error()})
		return
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	r.checks = append(r.checks, check{name, res.StatusCode == 200 && string(b) == want && res.Header.Get("Access-Control-Allow-Origin") == origin,
		fmt.Sprintf("%d, %d bytes, allow-origin %q", res.StatusCode, len(b), res.Header.Get("Access-Control-Allow-Origin"))})
}

// reactFlowLayout builds the body the editor saves: all five palette nodes with
// the seeded defaults as variables, and edges made by React Flow's addEdge.
func reactFlowLayout(resources []map[string]any) map[string]any {
	defaults := func(label string) map[string]any {
		out := map[string]any{}
		for _, res := range resources {
			if res["label"] != label {
				continue
			}
			vars, _ := res["variables"].([]any)
			for _, v := range vars {
				vm, _ := v.(map[string]any)
				if vm["default"] != nil {
					out[fmt.Sprint(vm["name"])] = vm["default"]
				}
			}
		}
		return out
	}
	palette := []struct{ label, img, name string }{
		{"Lambda", "/aws/lambda.png", "smoke_fn"},
		{"S3", "/aws/s3.png", "smoke_bucket"},
		{"DynamoDB", "/aws/dynamodb.png", "smoke_table"},
		{"API Gateway", "/aws/apigateway.png", "smoke_api"},
		{"EC2 Container", "/aws/ec2.png", "smoke_vm"},
	}
	nodes := make([]any, 0, len(palette))
	ids := map[string]string{}
	for i, p := range palette {
		vars := defaults(p.label)
		vars["resource_name"] = p.name
		ids[p.label] = uuid.NewString()
		nodes = append(nodes, map[string]any{
			"id": ids[p.label], "type": "awsService", "position": map[string]any{"x": 120.5 + float64(i)*200, "y": 80},
			"data":     map[string]any{"label": p.label, "img": p.img, "variables": vars},
			"measured": map[string]any{"width": 160, "height": 72}, "selected": false, "dragging": false,
		})
	}
	edge := func(from, to string) map[string]any {
		a, b := ids[from], ids[to]
		return map[string]any{"source": a, "sourceHandle": nil, "target": b, "targetHandle": nil, "id": "xy-edge__" + a + "-" + b}
	}
	return map[string]any{
		"nodes": nodes,
		"edges": []any{edge("API Gateway", "Lambda"), edge("Lambda", "S3"), edge("Lambda", "DynamoDB")},
	}
}

func insertFixtureJob(connString, userID, orgID, projID, diaID string) (id, logKey string, err error) {
	ctx := context.Background()
	c, err := pgx.Connect(ctx, connString)
	if err != nil {
		return "", "", err
	}
	defer c.Close(ctx)
	id = uuid.NewString()
	logKey = fmt.Sprintf("%s/%s/%s/playbooks/logs/%s.log", orgID, projID, diaID, id)
	_, err = c.Exec(ctx, `
		INSERT INTO jobs (id, job_type, status, created_by, target_instance_ids, playbook_s3_key, log_s3_key, error_message)
		VALUES ($1, 'ansible', 'FAILED', $2, '["i-0123456789abcdef0"]'::jsonb, $3, $4, 'devserver smoke fixture: submit-job needs SQS')`,
		id, userID,
		fmt.Sprintf("%s/%s/%s/playbooks/%s-site.yml", orgID, projID, diaID, uuid.NewString()),
		logKey,
	)
	return id, logKey, err
}

// deleteFixtureJobs removes the fixture job and the job submit-job created for
// the uploaded playbook.
func deleteFixtureJobs(connString, id, playbookKey string) error {
	ctx := context.Background()
	c, err := pgx.Connect(ctx, connString)
	if err != nil {
		return err
	}
	defer c.Close(ctx)
	_, err = c.Exec(ctx, `DELETE FROM jobs WHERE id = $1 OR playbook_s3_key = $2`, id, playbookKey)
	return err
}

// gatewayChecks prints checks of the gateway itself, outside the 31 rows,
// after the checks the route calls recorded along the way.
func gatewayChecks(r *runner, s3Endpoint string) {
	cs := r.checks

	pre, _ := http.NewRequest("OPTIONS", r.api+"/organization", nil)
	pre.Header.Set("Origin", "http://localhost:3000")
	pre.Header.Set("Access-Control-Request-Method", "POST")
	if res, err := r.client.Do(pre); err == nil {
		res.Body.Close()
		cs = append(cs, check{"OPTIONS /organization (CORS preflight)", res.StatusCode == 200 && res.Header.Get("Access-Control-Allow-Origin") == "*",
			fmt.Sprintf("%d, allow-methods %q", res.StatusCode, res.Header.Get("Access-Control-Allow-Methods"))})
	}
	noTok := r.do("GET", "/organization", nil, "")
	cs = append(cs, check{"GET /organization without Authorization", noTok.status == 401, fmt.Sprintf("%d %s", noTok.status, summary(noTok))})

	forged := forgedToken()
	bad := r.do("GET", "/organization", nil, forged)
	cs = append(cs, check{"GET /organization with a token signed by another secret", bad.status == 403, fmt.Sprintf("%d %s", bad.status, summary(bad))})

	// The browser sends several requests at once; each must still succeed.
	const parallel = 30
	codes := make(chan int, parallel)
	for i := 0; i < parallel; i++ {
		go func() { codes <- r.do("GET", "/organization", nil, r.token).status }()
	}
	okCount, other := 0, map[int]int{}
	for i := 0; i < parallel; i++ {
		if c := <-codes; c == 200 {
			okCount++
		} else {
			other[c]++
		}
	}
	cs = append(cs, check{fmt.Sprintf("%d parallel GET /organization", parallel), okCount == parallel, fmt.Sprintf("%d of %d returned 200, others %v", okCount, parallel, other)})

	unknown := r.do("GET", "/no-such-route", nil, r.token)
	cs = append(cs, check{"GET /no-such-route", unknown.status == 403, fmt.Sprintf("%d %s", unknown.status, summary(unknown))})

	// The S3 store must not have opened the endpoint to anything else.
	before, _ := r.awsCalls(1 << 30)
	ecs, _ := http.NewRequest("POST", strings.TrimSuffix(s3Endpoint, gateway.LocalDataBucket+"/"), strings.NewReader("{}"))
	ecs.Header.Set("X-Amz-Target", "AmazonEC2ContainerServiceV20141113.RunTask")
	ecs.Header.Set("Content-Type", "application/x-amz-json-1.1")
	if res, err := r.client.Do(ecs); err != nil {
		cs = append(cs, check{"ECS call to the AWS endpoint", false, err.Error()})
	} else {
		res.Body.Close()
		_, refused := r.awsCalls(before)
		cs = append(cs, check{"ECS call to the AWS endpoint", res.StatusCode == 403 && len(refused) == 1, fmt.Sprintf("%d, refused %v", res.StatusCode, refused)})
	}

	fmt.Println("Gateway checks (not counted in the 31 routes):")
	w := tabwriter.NewWriter(os.Stdout, 2, 4, 2, ' ', 0)
	for _, c := range cs {
		v := "PASS"
		if !c.ok {
			v = "FAIL"
			failed = true
		}
		fmt.Fprintf(w, "  %s\t%s\t%s\n", v, c.name, c.note)
	}
	w.Flush()
	fmt.Println()
}

var failed bool

func forgedToken() string {
	tok, _, err := devauth.Sign(devauth.UserData{Uuid: uuid.NewString(), Email: "x@clutter.localhost", FullName: "X", CreatedAt: time.Now().UTC().Format(time.RFC3339)}, []byte("not-the-gateway-secret-0123456789abcdef"), time.Now())
	if err != nil {
		return "forged"
	}
	return tok
}

func report(r *runner) {
	w := tabwriter.NewWriter(os.Stdout, 2, 4, 2, ' ', 0)
	fmt.Fprintln(w, "#\tROUTE\tHTTP\tVERDICT\tREASON")
	counts := map[string]int{}
	for i, rw := range r.rows {
		fmt.Fprintf(w, "%d\t%s\t%d\t%s\t%s\n", i+1, rw.route, rw.status, rw.verdict, rw.reason)
		counts[rw.verdict]++
		if rw.verdict == "FAIL" {
			failed = true
		}
	}
	w.Flush()

	var missing []string
	for _, rt := range routes.Routes {
		if !r.hit[rt.Method+" "+rt.Path] {
			missing = append(missing, rt.Method+" "+rt.Path)
		}
	}
	sort.Strings(missing)
	fmt.Printf("\nroutes exercised: %d of %d", len(routes.Routes)-len(missing), len(routes.Routes))
	if len(missing) > 0 {
		fmt.Printf(" (missing: %s)", strings.Join(missing, ", "))
		failed = true
	}
	fmt.Printf("\ncalls: %d  PASS %d  NEEDS-AWS %d  EXPECTED %d  FAIL %d\n",
		len(r.rows), counts["PASS"], counts["NEEDS-AWS"], counts["EXPECTED"], counts["FAIL"])
	if failed {
		os.Exit(1)
	}
}

func fatal(r *runner, msg string) {
	fmt.Fprintln(os.Stderr, "smoke: stopped early: "+msg)
	failed = true
	report(r)
	os.Exit(1)
}
