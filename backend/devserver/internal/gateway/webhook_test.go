package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda/messages"
)

// saveInvoker allows every token, answers each handler with 200 and a diagram
// id, and records what the generation Lambda receives.
type saveInvoker struct {
	mu          sync.Mutex
	generations []events.APIGatewayProxyRequest
	saveStatus  int
	genFnErr    *messages.InvokeResponse_Error
	genErr      error
}

func (f *saveInvoker) Invoke(_ context.Context, fn string, payload []byte) ([]byte, *messages.InvokeResponse_Error, error) {
	if fn == "authorizer" {
		return (&fakeInvoker{allow: true}).Invoke(context.Background(), fn, payload)
	}
	if fn == "terraform-engine-create" {
		f.mu.Lock()
		defer f.mu.Unlock()
		var ev events.APIGatewayProxyRequest
		_ = json.Unmarshal(payload, &ev)
		f.generations = append(f.generations, ev)
		if f.genFnErr != nil || f.genErr != nil {
			return nil, f.genFnErr, f.genErr
		}
		out, _ := json.Marshal(events.APIGatewayProxyResponse{StatusCode: 200, Body: `{"message":"Terraform files generated successfully"}`})
		return out, nil, nil
	}
	status := f.saveStatus
	if status == 0 {
		status = 200
	}
	out, _ := json.Marshal(events.APIGatewayProxyResponse{StatusCode: status, Body: `{"data":{"id":"diagram-1"}}`})
	return out, nil, nil
}

func saveThrough(t *testing.T, f *saveInvoker, method, target string, bodyErr error) (*httptest.ResponseRecorder, []string, string) {
	t.Helper()
	logs := &strings.Builder{}
	logger := log.New(logs, "", 0)
	s := NewServer(f, log.New(io.Discard, "", 0), nil)
	var events []string
	hook := NewGenerationHook(f, "", logger)
	hook.body = func(_ context.Context, eventType, diagramID string) ([]byte, error) {
		events = append(events, eventType+" "+diagramID)
		return []byte(`{"type":"` + eventType + `","table":"diagrams"}`), bodyErr
	}
	s.Generation = hook
	req := httptest.NewRequest(method, target, strings.NewReader(`{}`))
	req.Header.Set("Authorization", "tok")
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	hook.Wait()
	return rec, events, logs.String()
}

func TestSavesInvokeTheGenerationLambda(t *testing.T) {
	for method, want := range map[string]string{"POST": "INSERT diagram-1", "PUT": "UPDATE diagram-1"} {
		f := &saveInvoker{}
		rec, events, logs := saveThrough(t, f, method, "/diagram", nil)
		if rec.Code != 200 {
			t.Fatalf("%s: save answered %d", method, rec.Code)
		}
		if len(events) != 1 || events[0] != want {
			t.Fatalf("%s: events %v", method, events)
		}
		if len(f.generations) != 1 {
			t.Fatalf("%s: %d generations", method, len(f.generations))
		}
		ev := f.generations[0]
		if ev.HTTPMethod != "POST" || ev.Resource != "/terraform-engine" || !strings.Contains(ev.Body, `"table":"diagrams"`) {
			t.Errorf("%s: event %+v", method, ev)
		}
		if ev.RequestContext.Authorizer != nil {
			t.Errorf("%s: the webhook route has no authorizer", method)
		}
		if !strings.Contains(logs, "terraform-engine-create answered 200") {
			t.Errorf("%s: result not logged: %q", method, logs)
		}
	}
}

func TestGenerationFailureDoesNotFailTheSave(t *testing.T) {
	cases := map[string]struct {
		f       *saveInvoker
		bodyErr error
		want    string
	}{
		"function error": {f: &saveInvoker{genFnErr: &messages.InvokeResponse_Error{Message: "boom", Type: "panic"}}, want: "boom"},
		"invoke error":   {f: &saveInvoker{genErr: errors.New("timed out")}, want: "timed out"},
		"row unreadable": {f: &saveInvoker{}, bodyErr: errors.New("no row"), want: "no row"},
	}
	for name, c := range cases {
		rec, _, logs := saveThrough(t, c.f, "PUT", "/diagram", c.bodyErr)
		if rec.Code != 200 || !strings.Contains(rec.Body.String(), "diagram-1") {
			t.Errorf("%s: save answered %d %q", name, rec.Code, rec.Body.String())
		}
		if !strings.Contains(logs, c.want) {
			t.Errorf("%s: failure not logged: %q", name, logs)
		}
	}
}

func TestOnlySuccessfulDiagramSavesGenerate(t *testing.T) {
	f := &saveInvoker{saveStatus: 409}
	if rec, events, _ := saveThrough(t, f, "PUT", "/diagram", nil); rec.Code != 409 || len(events) != 0 {
		t.Errorf("failed save: %d %v", rec.Code, events)
	}
	for _, c := range [][2]string{{"GET", "/diagram"}, {"DELETE", "/diagram"}, {"POST", "/project"}} {
		if _, events, _ := saveThrough(t, &saveInvoker{}, c[0], c[1], nil); len(events) != 0 {
			t.Errorf("%s %s generated: %v", c[0], c[1], events)
		}
	}
}
