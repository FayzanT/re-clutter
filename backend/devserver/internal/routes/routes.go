// Package routes is the devserver's copy of the API Gateway wiring in
// backend/infra/main.tf: which Lambda serves which method and path, which
// routes sit behind the custom authorizer, which methods each path's CORS
// preflight advertises, and which environment variables each Lambda gets.
//
// The table is hard-coded on purpose so the gateway never depends on HCL
// formatting at run time. routes_test.go parses main.tf and fails when the
// two disagree, so drift shows up in `go test`, not in a confusing local run.
package routes

import "sort"

// Lambda is one function from a `module "...-lambda"` block in main.tf.
type Lambda struct {
	// Name is the module's function_name.
	Name string
	// Dir is the module's zip_dir_slice, relative to backend/api.
	Dir string
	// TimeoutSeconds is the module's timeout (the lambda template defaults to 3).
	TimeoutSeconds int
	// EnvKeys are the keys of the module's environment_variables map.
	EnvKeys []string
}

// Route is one `module "...-api-integration"` block in main.tf.
type Route struct {
	Method string
	// Path is the API Gateway resource path, with {param} placeholders.
	Path string
	// Lambda is the function_name of the integrated Lambda.
	Lambda string
	// Authorized is true when the integration sets jwt_authorizer_id.
	Authorized bool
}

// AuthorizerLambda is the function behind the REQUEST custom authorizer.
const AuthorizerLambda = "authorizer"

// Lambdas lists every HTTP-facing Lambda plus the authorizer. ansible-run-task
// is an SQS consumer with no route, so the devserver does not run it.
var Lambdas = []Lambda{
	{Name: "log-in", Dir: "log-in", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING", "JWT_SECRET"}},
	{Name: "authorizer", Dir: "authorizer", TimeoutSeconds: 3, EnvKeys: []string{"JWT_SECRET"}},
	{Name: "cloudformation-stack-url-generator", Dir: "cloudformation/stack-url-generator", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING", "CLOUDFORMATION_TEMPLATE_URL", "CLUTTER_ACCOUNT_ID"}},
	{Name: "terraform-command-runner", Dir: "terraform-command-runner", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING", "ECS_CLUSTER_NAME", "TASK_DEFINITION_ARN", "CONTAINER_NAME", "SUBNET_IDS", "SECURITY_GROUP_ID"}},
	{Name: "organization-create", Dir: "organization/create", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING"}},
	{Name: "organization-get", Dir: "organization/get", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING", "CORS_ALLOWED_ORIGIN"}},
	{Name: "organization-update", Dir: "organization/update", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING", "CORS_ALLOWED_ORIGIN"}},
	{Name: "organization-delete", Dir: "organization/delete", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING", "CORS_ALLOWED_ORIGIN"}},
	{Name: "organization-submit-account-role-arn", Dir: "organization/accounts/submit-role-arn", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING"}},
	{Name: "organization-get-accounts", Dir: "organization/accounts/get", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING"}},
	{Name: "organization-delete-account", Dir: "organization/accounts/delete", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING"}},
	{Name: "project-create", Dir: "project/create", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING", "CORS_ALLOWED_ORIGIN"}},
	{Name: "project-get", Dir: "project/get", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING", "CORS_ALLOWED_ORIGIN"}},
	{Name: "project-update", Dir: "project/update", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING", "CORS_ALLOWED_ORIGIN"}},
	{Name: "project-delete", Dir: "project/delete", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING", "CORS_ALLOWED_ORIGIN"}},
	{Name: "diagram-create", Dir: "diagram/create", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING", "CORS_ALLOWED_ORIGIN"}},
	{Name: "diagram-get", Dir: "diagram/get", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING", "CORS_ALLOWED_ORIGIN"}},
	{Name: "diagram-update", Dir: "diagram/update", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING", "CORS_ALLOWED_ORIGIN"}},
	{Name: "diagram-delete", Dir: "diagram/delete", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING", "CORS_ALLOWED_ORIGIN"}},
	// main.tf gives user-information-get an empty environment.
	{Name: "user-information-get", Dir: "user-information/get", TimeoutSeconds: 3, EnvKeys: nil},
	{Name: "resources-get", Dir: "resources/get", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING"}},
	{Name: "terraform-engine-code-upload-presigned-url", Dir: "terraform-engine/code-upload", TimeoutSeconds: 3, EnvKeys: []string{"S3_BUCKET_NAME", "PSQL_CONNECTION_STRING"}},
	{Name: "terraform-engine-create", Dir: "terraform-engine/create", TimeoutSeconds: 3, EnvKeys: []string{"S3_BUCKET_NAME", "TEMPLATE_BUCKET_NAME", "PSQL_CONNECTION_STRING"}},
	{Name: "terraform-engine-files", Dir: "terraform-engine/files", TimeoutSeconds: 10, EnvKeys: []string{"S3_BUCKET_NAME", "PSQL_CONNECTION_STRING"}},
	{Name: "terraform-engine-logs-get", Dir: "terraform-engine/logs/get", TimeoutSeconds: 3, EnvKeys: []string{"S3_BUCKET_NAME", "PSQL_CONNECTION_STRING"}},
	{Name: "terraform-engine-logs-url", Dir: "terraform-engine/logs/url", TimeoutSeconds: 3, EnvKeys: []string{"S3_BUCKET_NAME", "PSQL_CONNECTION_STRING"}},
	{Name: "terraform-engine-logs-live", Dir: "terraform-engine/logs/live", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING", "ECS_CLUSTER_NAME", "TERRAFORM_DEPLOYER_LOG_GROUP", "TERRAFORM_DEPLOYER_LOG_STREAM_PREFIX", "TERRAFORM_DEPLOYER_CONTAINER_NAME"}},
	{Name: "terraform-command-runner-logs-recent-activity", Dir: "terraform-engine/logs/recent-activity", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING"}},
	{Name: "ansible-submit-job", Dir: "ansible/submit-job", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING", "JOB_QUEUE_URL", "CORS_ALLOWED_ORIGIN", "S3_BUCKET_NAME"}},
	{Name: "ansible-get-job", Dir: "ansible/get-job", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING", "CORS_ALLOWED_ORIGIN"}},
	{Name: "ansible-list-jobs", Dir: "ansible/list-jobs", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING", "CORS_ALLOWED_ORIGIN"}},
	{Name: "ansible-get-job-logs", Dir: "ansible/get-job-logs", TimeoutSeconds: 3, EnvKeys: []string{"PSQL_CONNECTION_STRING", "S3_BUCKET_NAME", "CORS_ALLOWED_ORIGIN"}},
	{Name: "ansible-create-playbook-upload-url", Dir: "ansible/create-playbook-upload-url", TimeoutSeconds: 3, EnvKeys: []string{"S3_BUCKET_NAME", "CORS_ALLOWED_ORIGIN", "PSQL_CONNECTION_STRING"}},
}

// SkippedLambdas are Lambdas in main.tf that have no HTTP route.
var SkippedLambdas = []string{"ansible-run-task"}

// Routes lists the 32 API Gateway integrations.
var Routes = []Route{
	{Method: "POST", Path: "/log-in", Lambda: "log-in", Authorized: false},
	{Method: "GET", Path: "/cloudformation-stack-url/{organizationId}", Lambda: "cloudformation-stack-url-generator", Authorized: true},
	{Method: "POST", Path: "/organization", Lambda: "organization-create", Authorized: true},
	{Method: "GET", Path: "/organization", Lambda: "organization-get", Authorized: true},
	{Method: "PUT", Path: "/organization/{organizationId}", Lambda: "organization-update", Authorized: true},
	{Method: "DELETE", Path: "/organization/{organizationId}", Lambda: "organization-delete", Authorized: true},
	{Method: "GET", Path: "/organization/{organizationId}/accounts", Lambda: "organization-get-accounts", Authorized: true},
	{Method: "POST", Path: "/organization/{organizationId}/accounts/{accountId}", Lambda: "organization-submit-account-role-arn", Authorized: true},
	{Method: "DELETE", Path: "/organization/{organizationId}/accounts/{accountId}", Lambda: "organization-delete-account", Authorized: true},
	{Method: "POST", Path: "/project", Lambda: "project-create", Authorized: true},
	{Method: "GET", Path: "/project", Lambda: "project-get", Authorized: true},
	{Method: "PUT", Path: "/project", Lambda: "project-update", Authorized: true},
	{Method: "DELETE", Path: "/project", Lambda: "project-delete", Authorized: true},
	{Method: "POST", Path: "/diagram", Lambda: "diagram-create", Authorized: true},
	{Method: "GET", Path: "/diagram", Lambda: "diagram-get", Authorized: true},
	{Method: "PUT", Path: "/diagram", Lambda: "diagram-update", Authorized: true},
	{Method: "DELETE", Path: "/diagram", Lambda: "diagram-delete", Authorized: true},
	{Method: "POST", Path: "/terraform-command-runner", Lambda: "terraform-command-runner", Authorized: true},
	{Method: "GET", Path: "/terraform-engine/files", Lambda: "terraform-engine-files", Authorized: true},
	{Method: "GET", Path: "/terraform-engine/logs", Lambda: "terraform-engine-logs-get", Authorized: true},
	{Method: "GET", Path: "/terraform-engine/logs/url", Lambda: "terraform-engine-logs-url", Authorized: true},
	{Method: "GET", Path: "/terraform-engine/logs/live", Lambda: "terraform-engine-logs-live", Authorized: true},
	{Method: "GET", Path: "/terraform-engine/logs/recent-activity", Lambda: "terraform-command-runner-logs-recent-activity", Authorized: true},
	{Method: "POST", Path: "/ansible/jobs", Lambda: "ansible-submit-job", Authorized: true},
	{Method: "GET", Path: "/ansible/jobs", Lambda: "ansible-list-jobs", Authorized: true},
	{Method: "GET", Path: "/ansible/jobs/{jobId}", Lambda: "ansible-get-job", Authorized: true},
	{Method: "GET", Path: "/ansible/jobs/{jobId}/logs", Lambda: "ansible-get-job-logs", Authorized: true},
	{Method: "POST", Path: "/ansible/playbooks/upload-url", Lambda: "ansible-create-playbook-upload-url", Authorized: true},
	{Method: "GET", Path: "/user-information", Lambda: "user-information-get", Authorized: true},
	{Method: "GET", Path: "/resources", Lambda: "resources-get", Authorized: false},
	{Method: "POST", Path: "/terraform-engine", Lambda: "terraform-engine-create", Authorized: false},
	{Method: "POST", Path: "/terraform-engine/code-upload/presigned-url", Lambda: "terraform-engine-code-upload-presigned-url", Authorized: true},
}

// CORS maps each path that has an `api-path-cors-compliance` module to the
// http_methods it lists. API Gateway answers OPTIONS on these paths with a
// MOCK integration; any other path has no OPTIONS method.
var CORS = map[string][]string{
	"/log-in": {"POST"},
	"/cloudformation-stack-url/{organizationId}":          {"GET"},
	"/terraform-command-runner":                           {"POST"},
	"/organization":                                       {"POST", "GET"},
	"/organization/{organizationId}":                      {"PUT", "DELETE"},
	"/organization/{organizationId}/accounts":             {"GET"},
	"/organization/{organizationId}/accounts/{accountId}": {"POST", "DELETE"},
	"/project":                                    {"POST", "GET", "PUT", "DELETE"},
	"/diagram":                                    {"POST", "GET", "PUT", "DELETE"},
	"/user-information":                           {"GET"},
	"/resources":                                  {"GET"},
	"/terraform-engine":                           {"POST", "GET"},
	"/terraform-engine/files":                     {"GET"},
	"/terraform-engine/logs":                      {"GET"},
	"/terraform-engine/logs/url":                  {"GET"},
	"/terraform-engine/logs/live":                 {"GET"},
	"/terraform-engine/logs/recent-activity":      {"GET"},
	"/terraform-engine/code-upload/presigned-url": {"POST"},
	"/ansible/jobs":                               {"POST", "GET"},
	"/ansible/jobs/{jobId}":                       {"GET"},
	"/ansible/jobs/{jobId}/logs":                  {"GET"},
	"/ansible/playbooks/upload-url":               {"POST"},
}

// CORSAllowHeaders is the Access-Control-Allow-Headers value the
// api-path-cors-compliance module's MOCK integration returns.
const CORSAllowHeaders = "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token"

// LambdaByName returns the Lambda with the given function name.
func LambdaByName(name string) (Lambda, bool) {
	for _, l := range Lambdas {
		if l.Name == name {
			return l, true
		}
	}
	return Lambda{}, false
}

// AllEnvKeys returns every environment key any Lambda reads, sorted.
func AllEnvKeys() []string {
	seen := map[string]bool{}
	for _, l := range Lambdas {
		for _, k := range l.EnvKeys {
			seen[k] = true
		}
	}
	keys := make([]string, 0, len(seen))
	for k := range seen {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
