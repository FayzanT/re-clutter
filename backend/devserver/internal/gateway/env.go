package gateway

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"

	"github.com/jackc/pgx/v5"
)

// LocalSecretPrefix marks a JWT secret as one dev.sh generated for this
// machine. The gateway refuses any other secret so a real platform secret is
// never loaded into a dev process by mistake.
const LocalSecretPrefix = "devserver-local-"

// Config is what the gateway needs from its environment and flags.
type Config struct {
	JWTSecret      string
	PSQLConnString string
	// FrontendOrigin is what main.tf passes as var.frontend_url.
	FrontendOrigin string
	// AWSEndpoint is where every AWS SDK call from a Lambda is sent. The
	// gateway serves it on loopback, answers S3 from local disk and refuses
	// the rest, so no Lambda can reach a real AWS account from a dev run.
	AWSEndpoint string
	// HomeDir is an empty directory used as each Lambda's HOME, so no shared
	// AWS config or credentials file under the real home is ever read.
	HomeDir string
}

// Fixed stand-ins for the platform values main.tf passes to the Lambdas. None
// of them name a real resource.
const (
	localAccountID = "000000000000"
	localRegion    = "us-west-2"

	// LocalDataBucket and LocalTemplateBucket stand in for the clutter and
	// templates buckets. The local S3 serves these two and no others.
	LocalDataBucket     = "clutter-devserver-local"
	LocalTemplateBucket = "clutter-devserver-local-templates"
)

// lambdaEnvValue returns the local value for one key a Lambda reads in main.tf.
// An unknown key is an error so a new variable in main.tf fails the start-up
// loudly instead of reaching a handler empty.
func lambdaEnvValue(key string, c Config) (string, error) {
	switch key {
	case "PSQL_CONNECTION_STRING":
		return c.PSQLConnString, nil
	case "JWT_SECRET":
		return c.JWTSecret, nil
	case "CORS_ALLOWED_ORIGIN":
		return c.FrontendOrigin, nil
	case "CLOUDFORMATION_TEMPLATE_URL":
		return "https://devserver.invalid/client_side_terraform_deployer_role.yaml", nil
	case "CLUTTER_ACCOUNT_ID":
		return localAccountID, nil
	case "S3_BUCKET_NAME":
		return LocalDataBucket, nil
	case "TEMPLATE_BUCKET_NAME":
		return LocalTemplateBucket, nil
	case "ECS_CLUSTER_NAME":
		return "clutter-devserver-local", nil
	case "TASK_DEFINITION_ARN":
		return "arn:aws:ecs:" + localRegion + ":" + localAccountID + ":task-definition/terraform-deployer:1", nil
	case "CONTAINER_NAME":
		return "terraform-deployer", nil
	case "SUBNET_IDS":
		return "subnet-00000000000000000", nil
	case "SECURITY_GROUP_ID":
		return "sg-00000000000000000", nil
	case "JOB_QUEUE_URL":
		return c.AWSEndpoint + "/" + localAccountID + "/ansible-engine-jobs-queue", nil
	// The next three are literals in main.tf; keep them identical.
	case "TERRAFORM_DEPLOYER_LOG_GROUP":
		return "/ecs/terraform-deployer", nil
	case "TERRAFORM_DEPLOYER_LOG_STREAM_PREFIX":
		return "ecs", nil
	case "TERRAFORM_DEPLOYER_CONTAINER_NAME":
		return "terraform-deployer", nil
	}
	return "", fmt.Errorf("no local value for Lambda environment variable %q; add one in devserver/internal/gateway/env.go", key)
}

// processEnv builds the complete environment for one Lambda process. Nothing
// is inherited from the gateway's own environment.
func processEnv(fn string, keys []string, port string, c Config) ([]string, error) {
	env := []string{
		"_LAMBDA_SERVER_PORT=" + port,
		"AWS_LAMBDA_FUNCTION_NAME=" + fn,
		"AWS_LAMBDA_FUNCTION_MEMORY_SIZE=128",
		"TZ=UTC",
		"HOME=" + c.HomeDir,
		// The Lambda runtime always sets the region.
		"AWS_REGION=" + localRegion,
		"AWS_DEFAULT_REGION=" + localRegion,
		// Static fake credentials and no config files: the SDK never looks
		// for real credentials, and every call goes to the loopback endpoint.
		"AWS_ACCESS_KEY_ID=DEVSERVERLOCALONLY00",
		"AWS_SECRET_ACCESS_KEY=devserver-local-not-a-credential",
		"AWS_CONFIG_FILE=/dev/null",
		"AWS_SHARED_CREDENTIALS_FILE=/dev/null",
		"AWS_EC2_METADATA_DISABLED=true",
		"AWS_ENDPOINT_URL=" + c.AWSEndpoint,
	}
	for _, k := range keys {
		v, err := lambdaEnvValue(k, c)
		if err != nil {
			return nil, err
		}
		env = append(env, k+"="+v)
	}
	return env, nil
}

// ValidateConfig enforces the dev-only guard rails: a locally generated JWT
// secret and a Postgres on this machine.
func ValidateConfig(c Config) error {
	if !strings.HasPrefix(c.JWTSecret, LocalSecretPrefix) || len(c.JWTSecret) < len(LocalSecretPrefix)+32 {
		return errors.New("JWT_SECRET is not a devserver-local secret; run backend/devserver/dev.sh, which generates one")
	}
	if c.PSQLConnString == "" {
		return errors.New("PSQL_CONNECTION_STRING is empty")
	}
	pc, err := pgx.ParseConfig(c.PSQLConnString)
	if err != nil {
		return errors.New("PSQL_CONNECTION_STRING does not parse")
	}
	if !isLoopbackHost(pc.Host) {
		return errors.New("PSQL_CONNECTION_STRING must point at a Postgres on loopback (127.0.0.1, ::1 or localhost)")
	}
	u, err := url.Parse(c.AWSEndpoint)
	if err != nil || !isLoopbackHost(u.Hostname()) {
		return errors.New("the AWS endpoint must be on loopback")
	}
	if c.HomeDir == "" {
		return errors.New("HomeDir is empty")
	}
	return nil
}

// RequireLoopbackAddr refuses a listen address that is not on loopback.
func RequireLoopbackAddr(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("listen address %q: %w", addr, err)
	}
	if !isLoopbackHost(host) {
		return fmt.Errorf("listen address %q is not loopback; the devserver binds to 127.0.0.1 only", addr)
	}
	return nil
}

func isLoopbackHost(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
