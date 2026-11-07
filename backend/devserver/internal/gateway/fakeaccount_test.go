package gateway

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda/messages"
)

const testOrg = "11111111-1111-4111-8111-111111111111"

// accountsInvoker plays the authorizer and the three Lambdas the route calls.
type accountsInvoker struct {
	fakeInvoker
	complete   string // body of data.complete
	accountsAt int    // the status GET accounts answers
	calls      []string
	submitted  string
}

func (a *accountsInvoker) Invoke(ctx context.Context, fn string, payload []byte) ([]byte, *messages.InvokeResponse_Error, error) {
	if fn == "authorizer" {
		return a.fakeInvoker.Invoke(ctx, fn, payload)
	}
	a.calls = append(a.calls, fn)
	var ev events.APIGatewayProxyRequest
	_ = json.Unmarshal(payload, &ev)
	reply := func(status int, body string) ([]byte, *messages.InvokeResponse_Error, error) {
		out, _ := json.Marshal(events.APIGatewayProxyResponse{StatusCode: status, Body: body})
		return out, nil, nil
	}
	switch fn {
	case "organization-get-accounts":
		if a.accountsAt != http.StatusOK {
			return reply(a.accountsAt, `{"error":"user does not have access"}`)
		}
		return reply(http.StatusOK, `{"data":{"complete":`+a.complete+`}}`)
	case "cloudformation-stack-url-generator":
		return reply(http.StatusOK, `{"data":{"account_id":"acct-1","url":"https://console.invalid/#/stacks/create?param_UniqueId=abc123&stackName=x"}}`)
	case "organization-submit-account-role-arn":
		a.submitted = ev.PathParameters["accountId"] + " " + ev.Body
		return reply(http.StatusOK, `{"message":"ok"}`)
	}
	return reply(http.StatusInternalServerError, `{}`)
}

func linkRequest(t *testing.T, a *accountsInvoker, method, origin, auth, body string) *httptest.ResponseRecorder {
	t.Helper()
	s := NewServer(a, log.New(io.Discard, "", 0), nil)
	req := httptest.NewRequest(method, LinkFakeAccountPath, strings.NewReader(body))
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if auth != "" {
		req.Header.Set("Authorization", auth)
	}
	rec := httptest.NewRecorder()
	s.LinkFakeAccountHandler().ServeHTTP(rec, req)
	return rec
}

func validBody() string { return `{"organizationId":"` + testOrg + `"}` }

func TestLinkFakeAccountRunsTheRealRoutesInOrder(t *testing.T) {
	a := &accountsInvoker{fakeInvoker: fakeInvoker{allow: true}, complete: "[]", accountsAt: http.StatusOK}
	rec := linkRequest(t, a, "POST", "http://localhost:3000", "token", validBody())
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	want := "organization-get-accounts,cloudformation-stack-url-generator,organization-submit-account-role-arn"
	if got := strings.Join(a.calls, ","); got != want {
		t.Fatalf("calls: %s", got)
	}
	if !strings.HasPrefix(a.submitted, "acct-1 ") || !strings.Contains(a.submitted, "AllowClutterToDeployTerraformRole-abc123") {
		t.Fatalf("submitted: %s", a.submitted)
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:3000" {
		t.Fatalf("allow-origin: %q", rec.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestLinkFakeAccountLeavesALinkedOrganizationAlone(t *testing.T) {
	a := &accountsInvoker{fakeInvoker: fakeInvoker{allow: true}, complete: `[{"id":"x"}]`, accountsAt: http.StatusOK}
	rec := linkRequest(t, a, "POST", "", "token", validBody())
	if rec.Code != http.StatusOK || len(a.calls) != 1 {
		t.Fatalf("status %d calls %v", rec.Code, a.calls)
	}
}

func TestLinkFakeAccountReturnsTheMembershipRefusal(t *testing.T) {
	a := &accountsInvoker{fakeInvoker: fakeInvoker{allow: true}, accountsAt: http.StatusForbidden}
	rec := linkRequest(t, a, "POST", "", "token", validBody())
	if rec.Code != http.StatusForbidden || len(a.calls) != 1 {
		t.Fatalf("status %d calls %v", rec.Code, a.calls)
	}
}

func TestLinkFakeAccountNeedsARealLogin(t *testing.T) {
	for name, tc := range map[string]struct {
		allow  bool
		auth   string
		status int
	}{
		"no token":  {true, "", http.StatusUnauthorized},
		"bad token": {false, "bad", http.StatusForbidden},
	} {
		t.Run(name, func(t *testing.T) {
			a := &accountsInvoker{fakeInvoker: fakeInvoker{allow: tc.allow}}
			rec := linkRequest(t, a, "POST", "", tc.auth, validBody())
			if rec.Code != tc.status || len(a.calls) != 0 {
				t.Fatalf("status %d calls %v", rec.Code, a.calls)
			}
		})
	}
}

func TestLinkFakeAccountAnswersLoopbackOriginsOnly(t *testing.T) {
	for _, method := range []string{"POST", "OPTIONS"} {
		a := &accountsInvoker{fakeInvoker: fakeInvoker{allow: true}, accountsAt: http.StatusOK, complete: "[]"}
		rec := linkRequest(t, a, method, "https://evil.example", "token", validBody())
		if rec.Code != http.StatusForbidden || len(a.calls) != 0 {
			t.Fatalf("%s: status %d calls %v", method, rec.Code, a.calls)
		}
		if rec.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Fatalf("%s: allow-origin set for a foreign origin", method)
		}
	}
	rec := linkRequest(t, &accountsInvoker{}, "OPTIONS", "http://127.0.0.1:3100", "", "")
	if rec.Code != http.StatusNoContent || rec.Header().Get("Access-Control-Allow-Origin") != "http://127.0.0.1:3100" {
		t.Fatalf("status %d allow-origin %q", rec.Code, rec.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestLinkFakeAccountRefusesBadInput(t *testing.T) {
	for _, tc := range []struct {
		method, body string
		status       int
	}{
		{"GET", "", http.StatusMethodNotAllowed},
		{"POST", "not json", http.StatusBadRequest},
		{"POST", `{"organizationId":"../other"}`, http.StatusBadRequest},
	} {
		a := &accountsInvoker{fakeInvoker: fakeInvoker{allow: true}}
		rec := linkRequest(t, a, tc.method, "", "token", tc.body)
		if rec.Code != tc.status || len(a.calls) != 0 {
			t.Fatalf("%s %q: status %d calls %v", tc.method, tc.body, rec.Code, a.calls)
		}
	}
}
