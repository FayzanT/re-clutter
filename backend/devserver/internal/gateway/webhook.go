package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/jackc/pgx/v5"
)

// webhookPath is the route the Supabase database webhook posts to.
const webhookPath = "/terraform-engine"

// generationTimeout bounds one webhook delivery, queueing included.
const generationTimeout = 30 * time.Second

// saveEvents maps the Lambdas that save a diagram to the database event each
// one causes. The webhook fires on the table, so these are the only triggers.
var saveEvents = map[string]string{
	"diagram-create": "INSERT",
	"diagram-update": "UPDATE",
}

// webhookBodyQuery builds the body a Supabase database webhook sends for a row
// of public.diagrams. Supabase serialises rows the same way (to_jsonb), and
// sends old_record as null on INSERT. The row before an UPDATE is gone by now,
// so old_record takes its name and data from the history row the update wrote.
const webhookBodyQuery = `
	SELECT jsonb_build_object(
		'type', $2::text,
		'table', 'diagrams',
		'schema', 'public',
		'record', to_jsonb(d),
		'old_record', CASE WHEN $2::text = 'UPDATE' THEN to_jsonb(d) || COALESCE((
			SELECT jsonb_build_object('name', h.name, 'data', h.data)
			FROM diagram_history h
			WHERE h.diagram_id = d.id
			ORDER BY h.version DESC
			LIMIT 1
		), '{}'::jsonb) END
	)
	FROM diagrams d
	WHERE d.id = $1::uuid`

// GenerationHook stands in for the Supabase database webhook, which in AWS is
// configured in Supabase, outside this repo. After a save it reads the row and
// invokes the real generation Lambda with the webhook's body. Like the real
// webhook it runs after the save has been answered, so a failure here is only
// a log line and never reaches the save.
type GenerationHook struct {
	invoker Invoker
	logger  *log.Logger
	// body returns the webhook body for one saved diagram.
	body     func(ctx context.Context, eventType, diagramID string) ([]byte, error)
	inFlight sync.WaitGroup
}

// NewGenerationHook returns a hook that reads diagrams from connString.
func NewGenerationHook(invoker Invoker, connString string, logger *log.Logger) *GenerationHook {
	return &GenerationHook{
		invoker: invoker,
		logger:  logger,
		body: func(ctx context.Context, eventType, diagramID string) ([]byte, error) {
			conn, err := pgx.Connect(ctx, connString)
			if err != nil {
				return nil, errors.New("could not connect to Postgres")
			}
			defer conn.Close(ctx)
			var body []byte
			err = conn.QueryRow(ctx, webhookBodyQuery, diagramID, eventType).Scan(&body)
			return body, err
		},
	}
}

// DiagramSaved takes the successful response of any Lambda and, when that
// Lambda saved a diagram, starts a generation in the background.
func (h *GenerationHook) DiagramSaved(fn string, proxyResponse []byte) {
	eventType, ok := saveEvents[fn]
	if !ok {
		return
	}
	var resp events.APIGatewayProxyResponse
	var saved struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(proxyResponse, &resp); err != nil {
		h.logger.Printf("[webhook] %s: unreadable response: %v", fn, err)
		return
	}
	if err := json.Unmarshal([]byte(resp.Body), &saved); err != nil || saved.Data.ID == "" {
		h.logger.Printf("[webhook] %s: the response names no diagram id", fn)
		return
	}
	h.inFlight.Add(1)
	go func() {
		defer h.inFlight.Done()
		h.generate(eventType, saved.Data.ID)
	}()
}

// Wait blocks until every started generation has finished.
func (h *GenerationHook) Wait() {
	h.inFlight.Wait()
}

func (h *GenerationHook) generate(eventType, diagramID string) {
	ctx, cancel := context.WithTimeout(context.Background(), generationTimeout)
	defer cancel()

	// Reading the row here, not at save time, means that of two quick saves
	// the last generation always sees the newest data.
	body, err := h.body(ctx, eventType, diagramID)
	if err != nil {
		h.logger.Printf("[webhook] %s diagram %s: read the row: %v", eventType, diagramID, err)
		return
	}
	m, resource, ok := findRoute(http.MethodPost, webhookPath)
	if !ok {
		h.logger.Printf("[webhook] %s diagram %s: no route for POST %s", eventType, diagramID, webhookPath)
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, webhookPath, http.NoBody)
	if err != nil {
		h.logger.Printf("[webhook] %s diagram %s: %v", eventType, diagramID, err)
		return
	}
	req.RemoteAddr = "127.0.0.1:0"
	payload, err := json.Marshal(buildEvent(req, resource, nil, body))
	if err != nil {
		h.logger.Printf("[webhook] %s diagram %s: %v", eventType, diagramID, err)
		return
	}

	out, fnErr, err := h.invoker.Invoke(ctx, m.route.Lambda, payload)
	switch {
	case err != nil:
		h.logger.Printf("[webhook] %s diagram %s: invoke %s: %v", eventType, diagramID, m.route.Lambda, err)
	case fnErr != nil:
		h.logger.Printf("[webhook] %s diagram %s: %s failed: %s: %s", eventType, diagramID, m.route.Lambda, fnErr.Type, fnErr.Message)
	default:
		var resp events.APIGatewayProxyResponse
		if err := json.Unmarshal(out, &resp); err != nil {
			h.logger.Printf("[webhook] %s diagram %s: unreadable response from %s", eventType, diagramID, m.route.Lambda)
			return
		}
		h.logger.Printf("[webhook] %s diagram %s: %s answered %d: %s", eventType, diagramID, m.route.Lambda, resp.StatusCode, resp.Body)
	}
}
