package gateway

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/google/uuid"
)

// LinkFakeAccountPath is the dev-only route behind the editor's Link fake
// account button.
const LinkFakeAccountPath = "/dev/link-fake-account"

// fakeRoleArn is what the Link fake account button submits: a role in no real account,
// in the form the submit-role-arn Lambda and the API Gateway model accept.
const fakeRoleArn = "arn:aws:iam::123456789012:role/AllowClutterToDeployTerraformRole-"

// LinkFakeAccountHandler links a fake account for one
// organization, for the signed-in caller. Every step is a call to the real
// route with the caller's own token, so the real authorizer and each Lambda's
// membership check decide, and a refusal is returned as it stands. Only
// Postgres is written; no AWS call is made.
func (s *Server) LinkFakeAccountHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		allowed := setCORS(w, r)
		if r.Header.Get("Origin") != "" && !allowed {
			writeDevJSON(w, http.StatusForbidden, "this route answers loopback origins only")
			return
		}
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "POST,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization,Content-Type")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST,OPTIONS")
			writeDevJSON(w, http.StatusMethodNotAllowed, "use POST")
			return
		}

		var body struct {
			OrganizationID string `json:"organizationId"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&body); err != nil || uuid.Validate(body.OrganizationID) != nil {
			writeDevJSON(w, http.StatusBadRequest, "a valid organizationId is required")
			return
		}
		org := url.PathEscape(body.OrganizationID)

		// Reading the accounts proves the caller first: a stranger stops here.
		status, raw := s.callRoute(r, http.MethodGet, "/organization/"+org+"/accounts", nil)
		if status != http.StatusOK {
			writeRouteRefusal(w, status, raw)
			return
		}
		var accounts struct {
			Data struct {
				Complete []json.RawMessage `json:"complete"`
			} `json:"data"`
		}
		if err := json.Unmarshal(raw, &accounts); err != nil {
			writeDevJSON(w, http.StatusBadGateway, "could not read the organization's accounts")
			return
		}
		if len(accounts.Data.Complete) > 0 {
			writeDevJSON(w, http.StatusOK, "the organization already has a linked account")
			return
		}

		name := "localfake" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
		status, raw = s.callRoute(r, http.MethodGet, "/cloudformation-stack-url/"+org+"?accountName="+name+"&region="+localRegion, nil)
		if status != http.StatusOK {
			writeRouteRefusal(w, status, raw)
			return
		}
		accountID, uniqueID, err := parseStackURL(raw)
		if err != nil {
			writeDevJSON(w, http.StatusBadGateway, err.Error())
			return
		}

		role, _ := json.Marshal(map[string]string{"role_arn": fakeRoleArn + uniqueID})
		status, raw = s.callRoute(r, http.MethodPost, "/organization/"+org+"/accounts/"+url.PathEscape(accountID), role)
		if status < 200 || status >= 300 {
			writeRouteRefusal(w, status, raw)
			return
		}
		writeDevJSON(w, http.StatusOK, "linked a fake account")
	})
}

// parseStackURL pulls the account id and the unique id out of the stack-url
// Lambda's answer. The URL's query sits after the console's #/ fragment.
func parseStackURL(raw []byte) (accountID, uniqueID string, err error) {
	var stack struct {
		Data struct {
			URL       string `json:"url"`
			AccountID string `json:"account_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &stack); err != nil {
		return "", "", fmt.Errorf("could not read the stack URL answer")
	}
	u, err := url.Parse(stack.Data.URL)
	if err != nil {
		return "", "", fmt.Errorf("could not read the stack URL")
	}
	query := u.RawQuery
	if _, after, found := strings.Cut(u.Fragment, "?"); found {
		query = after
	}
	values, err := url.ParseQuery(query)
	if err != nil {
		return "", "", fmt.Errorf("could not read the stack URL")
	}
	uniqueID = values.Get("param_UniqueId")
	if stack.Data.AccountID == "" || uniqueID == "" {
		return "", "", fmt.Errorf("the stack URL answer has no account or unique id")
	}
	return stack.Data.AccountID, uniqueID, nil
}

// callRoute sends one request through this server with the caller's token.
func (s *Server) callRoute(r *http.Request, method, target string, body []byte) (int, []byte) {
	req, err := http.NewRequestWithContext(r.Context(), method, target, bytes.NewReader(body))
	if err != nil {
		return http.StatusInternalServerError, nil
	}
	req.Header.Set("Authorization", r.Header.Get("Authorization"))
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = r.RemoteAddr
	out := &bufferedResponse{header: http.Header{}, status: http.StatusOK}
	s.ServeHTTP(out, req)
	return out.status, out.body.Bytes()
}

type bufferedResponse struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (b *bufferedResponse) Header() http.Header         { return b.header }
func (b *bufferedResponse) WriteHeader(status int)      { b.status = status }
func (b *bufferedResponse) Write(p []byte) (int, error) { return b.body.Write(p) }

func writeDevJSON(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"message": message})
}

func writeRouteRefusal(w http.ResponseWriter, status int, raw []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}
