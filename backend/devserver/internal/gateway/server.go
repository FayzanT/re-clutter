package gateway

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/Alberta2514640/clutter/backend/devserver/internal/routes"
	"github.com/aws/aws-lambda-go/events"
	"github.com/google/uuid"
)

// Values the gateway puts in each event's request context. They stand in for
// the REST API's ids and stage, which only exist in AWS.
const (
	apiID      = "devserver"
	stageName  = "local"
	maxPayload = 10 << 20 // API Gateway's 10 MB request payload limit
)

// Server translates HTTP requests into API Gateway REST proxy events, the way
// the platform's API Gateway does, and the Lambda responses back.
type Server struct {
	invoker Invoker
	logger  *log.Logger
	// extra handles paths outside the API, such as /dev/login. It is checked
	// before the route table and may be nil.
	extra map[string]http.Handler
	// Generation, when set, hears about every successful Lambda response so it
	// can stand in for the Supabase webhook.
	Generation *GenerationHook
}

// NewServer returns the API handler.
func NewServer(invoker Invoker, logger *log.Logger, extra map[string]http.Handler) *Server {
	return &Server{invoker: invoker, logger: logger, extra: extra}
}

type match struct {
	route  routes.Route
	params map[string]string
}

func splitPath(p string) []string {
	p = strings.Trim(p, "/")
	if p == "" {
		return nil
	}
	return strings.Split(p, "/")
}

// resolve finds the resource for a path. Literal segments win over
// {param} segments, as in API Gateway.
func resolve(path string) (resource string, params map[string]string, ok bool) {
	segs := splitPath(path)
	best, bestLiterals := "", -1
	var bestParams map[string]string
	seen := map[string]bool{}
	candidates := make([]string, 0, len(routes.Routes)+len(routes.CORS))
	for _, r := range routes.Routes {
		candidates = append(candidates, r.Path)
	}
	for p := range routes.CORS {
		candidates = append(candidates, p)
	}
	for _, cand := range candidates {
		if seen[cand] {
			continue
		}
		seen[cand] = true
		rs := splitPath(cand)
		if len(rs) != len(segs) {
			continue
		}
		literals := 0
		ps := map[string]string{}
		okc := true
		for i, s := range rs {
			if strings.HasPrefix(s, "{") && strings.HasSuffix(s, "}") {
				if segs[i] == "" {
					okc = false
					break
				}
				ps[s[1:len(s)-1]] = segs[i]
				continue
			}
			if s != segs[i] {
				okc = false
				break
			}
			literals++
		}
		if okc && literals > bestLiterals {
			best, bestLiterals, bestParams = cand, literals, ps
		}
	}
	if bestLiterals < 0 {
		return "", nil, false
	}
	return best, bestParams, true
}

func findRoute(method, path string) (match, string, bool) {
	resource, params, ok := resolve(path)
	if !ok {
		return match{}, "", false
	}
	for _, r := range routes.Routes {
		if r.Path == resource && r.Method == method {
			return match{route: r, params: params}, resource, true
		}
	}
	return match{}, resource, false
}

// writeGatewayError writes an error API Gateway itself produces. The platform
// Terraform configures no gateway responses, so these carry no CORS headers,
// exactly as in AWS: a browser sees them as CORS failures.
func writeGatewayError(w http.ResponseWriter, status int, errorType, body string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Amzn-ErrorType", errorType)
	w.WriteHeader(status)
	_, _ = io.WriteString(w, body)
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
	target := "-"
	defer func() {
		s.logger.Printf("%s %s -> %s %d %s", r.Method, r.URL.Path, target, rec.status, time.Since(start).Round(time.Millisecond))
	}()

	if h, ok := s.extra[r.URL.Path]; ok {
		target = "devserver"
		h.ServeHTTP(rec, r)
		return
	}

	if r.Method == http.MethodOptions {
		resource, _, ok := resolve(r.URL.Path)
		methods, hasCORS := routes.CORS[resource]
		if !ok || !hasCORS {
			writeGatewayError(rec, http.StatusForbidden, "MissingAuthenticationTokenException", `{"message":"Missing Authentication Token"}`)
			return
		}
		target = "cors-mock"
		rec.Header().Set("Content-Type", "application/json")
		rec.Header().Set("Access-Control-Allow-Headers", routes.CORSAllowHeaders)
		rec.Header().Set("Access-Control-Allow-Methods", strings.Join(methods, ",")+",OPTIONS")
		rec.Header().Set("Access-Control-Allow-Origin", "*")
		rec.WriteHeader(http.StatusOK)
		return
	}

	m, resource, ok := findRoute(r.Method, r.URL.Path)
	if !ok {
		writeGatewayError(rec, http.StatusForbidden, "MissingAuthenticationTokenException", `{"message":"Missing Authentication Token"}`)
		return
	}
	target = m.route.Lambda

	body, err := io.ReadAll(http.MaxBytesReader(rec, r.Body, maxPayload))
	if err != nil {
		writeGatewayError(rec, http.StatusRequestEntityTooLarge, "RequestTooLongException", `{"message":"Request Too Long"}`)
		return
	}

	event := buildEvent(r, resource, m.params, body)

	if m.route.Authorized {
		authCtx, status, errType, errBody := s.authorize(r, event)
		if status != 0 {
			target = routes.AuthorizerLambda
			writeGatewayError(rec, status, errType, errBody)
			return
		}
		event.RequestContext.Authorizer = authCtx
	}

	payload, err := json.Marshal(event)
	if err != nil {
		writeGatewayError(rec, http.StatusInternalServerError, "InternalServerErrorException", `{"message": "Internal server error"}`)
		return
	}
	out, fnErr, err := s.invoker.Invoke(r.Context(), m.route.Lambda, payload)
	if err != nil {
		s.logger.Printf("invoke %s failed: %v", m.route.Lambda, err)
		if errors.Is(err, ErrTimeout) {
			s.logger.Printf("[%s] Task timed out after %d seconds", m.route.Lambda, mustLambda(m.route.Lambda).TimeoutSeconds)
		}
		writeGatewayError(rec, http.StatusBadGateway, "InternalServerErrorException", `{"message": "Internal server error"}`)
		return
	}
	if fnErr != nil {
		s.logger.Printf("[%s] function error %s: %s", m.route.Lambda, fnErr.Type, fnErr.Message)
		writeGatewayError(rec, http.StatusBadGateway, "InternalServerErrorException", `{"message": "Internal server error"}`)
		return
	}
	writeProxyResponse(rec, out, s.logger, m.route.Lambda)
	if s.Generation != nil && rec.status >= 200 && rec.status < 300 {
		s.Generation.DiagramSaved(m.route.Lambda, out)
	}
}

func mustLambda(name string) routes.Lambda {
	l, _ := routes.LambdaByName(name)
	return l
}

// buildEvent fills the fields of the REST proxy event the handlers read, plus
// the request context API Gateway always sends.
func buildEvent(r *http.Request, resource string, params map[string]string, body []byte) events.APIGatewayProxyRequest {
	headers := map[string]string{}
	mvHeaders := map[string][]string{}
	for k, vs := range r.Header {
		mvHeaders[k] = vs
		headers[k] = vs[len(vs)-1]
	}
	if r.Host != "" {
		headers["Host"] = r.Host
		mvHeaders["Host"] = []string{r.Host}
	}
	var query map[string]string
	var mvQuery map[string][]string
	if q := r.URL.Query(); len(q) > 0 {
		query = map[string]string{}
		mvQuery = map[string][]string{}
		for k, vs := range q {
			query[k] = vs[len(vs)-1]
			mvQuery[k] = vs
		}
	}
	var pathParams map[string]string
	if len(params) > 0 {
		pathParams = params
	}
	sourceIP, _, _ := net.SplitHostPort(r.RemoteAddr)
	now := time.Now()
	return events.APIGatewayProxyRequest{
		Resource:                        resource,
		Path:                            r.URL.Path,
		HTTPMethod:                      r.Method,
		Headers:                         headers,
		MultiValueHeaders:               mvHeaders,
		QueryStringParameters:           query,
		MultiValueQueryStringParameters: mvQuery,
		PathParameters:                  pathParams,
		Body:                            string(body),
		IsBase64Encoded:                 false,
		RequestContext: events.APIGatewayProxyRequestContext{
			AccountID:        localAccountID,
			ResourceID:       "devserver",
			Stage:            stageName,
			RequestID:        uuid.NewString(),
			Identity:         events.APIGatewayRequestIdentity{SourceIP: sourceIP, UserAgent: r.UserAgent()},
			ResourcePath:     resource,
			HTTPMethod:       r.Method,
			RequestTime:      now.UTC().Format("02/Jan/2006:15:04:05 -0700"),
			RequestTimeEpoch: now.UnixMilli(),
			APIID:            apiID,
			Path:             "/" + stageName + r.URL.Path,
			Protocol:         r.Proto,
			DomainName:       r.Host,
		},
	}
}

func methodArn(method, resource string) string {
	return fmt.Sprintf("arn:aws:execute-api:%s:%s:%s/%s/%s%s", localRegion, localAccountID, apiID, stageName, method, resource)
}

// authorize runs the REQUEST authorizer the way API Gateway does. It returns
// the context to pass on, or an HTTP status and body to answer with.
func (s *Server) authorize(r *http.Request, event events.APIGatewayProxyRequest) (map[string]any, int, string, string) {
	// identity_source is method.request.header.Authorization: without it API
	// Gateway answers 401 and never calls the authorizer.
	if strings.TrimSpace(r.Header.Get("Authorization")) == "" {
		return nil, http.StatusUnauthorized, "UnauthorizedException", `{"message":"Unauthorized"}`
	}
	arn := methodArn(event.HTTPMethod, event.Resource)
	authEvent := events.APIGatewayCustomAuthorizerRequestTypeRequest{
		Type:                            "REQUEST",
		MethodArn:                       arn,
		Resource:                        event.Resource,
		Path:                            event.Path,
		HTTPMethod:                      event.HTTPMethod,
		Headers:                         event.Headers,
		MultiValueHeaders:               event.MultiValueHeaders,
		QueryStringParameters:           event.QueryStringParameters,
		MultiValueQueryStringParameters: event.MultiValueQueryStringParameters,
		PathParameters:                  event.PathParameters,
		RequestContext: events.APIGatewayCustomAuthorizerRequestTypeRequestContext{
			Path:         event.RequestContext.Path,
			AccountID:    event.RequestContext.AccountID,
			ResourceID:   event.RequestContext.ResourceID,
			Stage:        event.RequestContext.Stage,
			RequestID:    event.RequestContext.RequestID,
			ResourcePath: event.RequestContext.ResourcePath,
			HTTPMethod:   event.RequestContext.HTTPMethod,
			APIID:        event.RequestContext.APIID,
			Identity: events.APIGatewayCustomAuthorizerRequestTypeRequestIdentity{
				SourceIP: event.RequestContext.Identity.SourceIP,
			},
		},
	}
	payload, err := json.Marshal(authEvent)
	if err != nil {
		return nil, http.StatusInternalServerError, "AuthorizerConfigurationException", `{"message":null}`
	}
	out, fnErr, err := s.invoker.Invoke(r.Context(), routes.AuthorizerLambda, payload)
	if err != nil {
		s.logger.Printf("invoke authorizer failed: %v", err)
		return nil, http.StatusInternalServerError, "AuthorizerConfigurationException", `{"message":null}`
	}
	if fnErr != nil {
		// An authorizer that fails with exactly "Unauthorized" yields 401;
		// any other failure is a configuration error to API Gateway.
		if fnErr.Message == "Unauthorized" {
			return nil, http.StatusUnauthorized, "UnauthorizedException", `{"message":"Unauthorized"}`
		}
		s.logger.Printf("[authorizer] function error %s: %s", fnErr.Type, fnErr.Message)
		return nil, http.StatusInternalServerError, "AuthorizerConfigurationException", `{"message":null}`
	}
	var resp events.APIGatewayCustomAuthorizerResponse
	if err := json.Unmarshal(out, &resp); err != nil || resp.PrincipalID == "" {
		return nil, http.StatusInternalServerError, "AuthorizerConfigurationException", `{"message":null}`
	}
	allowed, denied := evaluatePolicy(resp.PolicyDocument, arn)
	if denied {
		return nil, http.StatusForbidden, "AccessDeniedException", `{"Message":"User is not authorized to access this resource with an explicit deny"}`
	}
	if !allowed {
		return nil, http.StatusForbidden, "AccessDeniedException", `{"Message":"User is not authorized to access this resource"}`
	}
	ctx := map[string]any{"principalId": resp.PrincipalID}
	for k, v := range resp.Context {
		// API Gateway hands context values to the integration as strings,
		// numbers or booleans only.
		switch v.(type) {
		case string, bool, float64, int, int64:
			ctx[k] = v
		default:
			return nil, http.StatusInternalServerError, "AuthorizerConfigurationException", `{"message":null}`
		}
	}
	return ctx, 0, "", ""
}

// evaluatePolicy checks execute-api:Invoke statements against the method ARN.
func evaluatePolicy(doc events.APIGatewayCustomAuthorizerPolicy, arn string) (allowed, denied bool) {
	for _, st := range doc.Statement {
		if !anyMatch(st.Action, "execute-api:Invoke") || !anyMatch(st.Resource, arn) {
			continue
		}
		switch st.Effect {
		case "Deny":
			denied = true
		case "Allow":
			allowed = true
		}
	}
	return allowed, denied
}

func anyMatch(patterns []string, value string) bool {
	for _, p := range patterns {
		if wildcardMatch(p, value) {
			return true
		}
	}
	return false
}

// wildcardMatch matches IAM-style patterns where * is any run and ? is one char.
func wildcardMatch(pattern, value string) bool {
	if pattern == "" {
		return value == ""
	}
	switch pattern[0] {
	case '*':
		for i := 0; i <= len(value); i++ {
			if wildcardMatch(pattern[1:], value[i:]) {
				return true
			}
		}
		return false
	case '?':
		return value != "" && wildcardMatch(pattern[1:], value[1:])
	default:
		return value != "" && pattern[0] == value[0] && wildcardMatch(pattern[1:], value[1:])
	}
}

// writeProxyResponse maps a Lambda proxy response onto the HTTP response. A
// response API Gateway cannot read becomes 502, as in AWS.
func writeProxyResponse(w http.ResponseWriter, out []byte, logger *log.Logger, fn string) {
	var resp events.APIGatewayProxyResponse
	if err := json.Unmarshal(out, &resp); err != nil || resp.StatusCode == 0 {
		logger.Printf("[%s] malformed Lambda proxy response", fn)
		writeGatewayError(w, http.StatusBadGateway, "InternalServerErrorException", `{"message": "Internal server error"}`)
		return
	}
	body := []byte(resp.Body)
	if resp.IsBase64Encoded {
		decoded, err := base64.StdEncoding.DecodeString(resp.Body)
		if err != nil {
			writeGatewayError(w, http.StatusBadGateway, "InternalServerErrorException", `{"message": "Internal server error"}`)
			return
		}
		body = decoded
	}
	for k, v := range resp.Headers {
		w.Header().Set(k, v)
	}
	for k, vs := range resp.MultiValueHeaders {
		w.Header().Del(k)
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "application/json")
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(body)
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}
