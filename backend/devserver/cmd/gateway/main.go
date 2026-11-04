// Command gateway runs System A's Lambdas locally behind an HTTP server that
// behaves like the platform's API Gateway. It is a development tool only: it
// binds to loopback, refuses a JWT secret it did not generate, and points
// every AWS SDK call at a local endpoint that refuses it.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/Alberta2514640/clutter/backend/devserver/internal/devauth"
	"github.com/Alberta2514640/clutter/backend/devserver/internal/gateway"
)

func main() {
	logger := log.New(os.Stderr, "", log.LstdFlags)
	if err := run(logger); err != nil {
		logger.Printf("gateway: %v", err)
		os.Exit(1)
	}
}

func run(logger *log.Logger) error {
	apiAddr := flag.String("api-addr", "127.0.0.1:8787", "API listen address (loopback only)")
	frontAddr := flag.String("front-addr", "127.0.0.1:3000", "front door listen address (loopback only); empty disables it")
	frontendUpstream := flag.String("frontend-upstream", "http://127.0.0.1:3100", "the Next.js dev server the front door forwards to")
	apiDir := flag.String("api-dir", "", "path to backend/api")
	stateDir := flag.String("state-dir", "", "directory for binaries, the Lambda HOME and the pid file")
	skipBuild := flag.Bool("skip-build", false, "reuse binaries already in <state-dir>/bin")
	flag.Parse()

	if *apiDir == "" || *stateDir == "" {
		return errors.New("-api-dir and -state-dir are required")
	}
	if err := gateway.RequireLoopbackAddr(*apiAddr); err != nil {
		return err
	}
	frontOrigin := "http://localhost:3000"
	if *frontAddr != "" {
		if err := gateway.RequireLoopbackAddr(*frontAddr); err != nil {
			return err
		}
		_, port, _ := net.SplitHostPort(*frontAddr)
		frontOrigin = "http://localhost:" + port
		up, err := url.Parse(*frontendUpstream)
		if err != nil || up.Hostname() == "" {
			return fmt.Errorf("bad -frontend-upstream %q", *frontendUpstream)
		}
		if err := gateway.RequireLoopbackAddr(up.Host); err != nil {
			return fmt.Errorf("-frontend-upstream: %w", err)
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// The endpoint that refuses every AWS call. It must exist before the
	// Lambdas start, since their environment points at it.
	noAWSLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	noAWS := gateway.NewNoAWS(logger)
	noAWSSrv := &http.Server{Handler: noAWS, ReadHeaderTimeout: 5 * time.Second}
	go func() { _ = noAWSSrv.Serve(noAWSLn) }()
	defer noAWSSrv.Close()

	homeDir := filepath.Join(*stateDir, "lambda-home")
	if err := os.MkdirAll(homeDir, 0o700); err != nil {
		return err
	}
	cfg := gateway.Config{
		JWTSecret:      os.Getenv("JWT_SECRET"),
		PSQLConnString: os.Getenv("PSQL_CONNECTION_STRING"),
		FrontendOrigin: frontOrigin,
		AWSEndpoint:    "http://" + noAWSLn.Addr().String(),
		HomeDir:        homeDir,
	}
	if err := gateway.ValidateConfig(cfg); err != nil {
		return err
	}

	binDir := filepath.Join(*stateDir, "bin")
	if !*skipBuild {
		logger.Printf("building Lambdas from %s", *apiDir)
		if err := gateway.BuildLambdas(ctx, *apiDir, binDir, logger); err != nil {
			return err
		}
	}

	pool := gateway.NewPool(cfg, binDir, logger)
	defer pool.Stop()
	if err := pool.Start(ctx); err != nil {
		return err
	}
	if err := writePids(filepath.Join(*stateDir, "lambda.pids"), pool.Pids()); err != nil {
		return err
	}

	issuer := &devauth.Issuer{ConnString: cfg.PSQLConnString, Secret: []byte(cfg.JWTSecret), FrontendOrigin: frontOrigin}
	extraHandlers := map[string]http.Handler{
		"/dev/login":     issuer.RedirectHandler(),
		"/dev/aws-calls": noAWS.CallsHandler(),
		"/dev/healthz": http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte("ok\n"))
		}),
	}
	apiHandler := gateway.NewServer(pool, logger, extraHandlers)
	extraHandlers["/dev/terraform-preview"] = apiHandler.TerraformPreviewHandler(
		cfg.PSQLConnString, filepath.Join(*stateDir, "terraform-preview"),
		filepath.Join(*apiDir, "..", "infra", "modules", "s3", "uploads"))
	servers := []*http.Server{{Addr: *apiAddr, Handler: apiHandler, ReadHeaderTimeout: 10 * time.Second}}

	if *frontAddr != "" {
		up, _ := url.Parse(*frontendUpstream)
		proxy := httputil.NewSingleHostReverseProxy(up)
		proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.WriteHeader(http.StatusBadGateway)
			fmt.Fprintf(w, "The frontend dev server is not reachable at %s.\nStart it as run.sh printed, then reload.\n", *frontendUpstream)
		}
		front := http.NewServeMux()
		front.Handle("/dev/login", issuer.BrowserHandler())
		front.Handle("/", proxy)
		servers = append(servers, &http.Server{Addr: *frontAddr, Handler: front, ReadHeaderTimeout: 10 * time.Second})
	}

	errc := make(chan error, len(servers))
	for _, s := range servers {
		ln, err := net.Listen("tcp", s.Addr)
		if err != nil {
			return err
		}
		logger.Printf("listening on http://%s", s.Addr)
		go func(s *http.Server, ln net.Listener) {
			if err := s.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
				errc <- err
			}
		}(s, ln)
	}
	logger.Printf("ready: API http://%s, dev sign-in %s/dev/login", *apiAddr, frontOrigin)

	select {
	case <-ctx.Done():
		logger.Printf("shutting down")
	case err := <-errc:
		logger.Printf("server error: %v", err)
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, s := range servers {
		_ = s.Shutdown(shutdownCtx)
	}
	return nil
}

func writePids(path string, pids []int) error {
	var b strings.Builder
	for _, p := range pids {
		b.WriteString(strconv.Itoa(p))
		b.WriteByte('\n')
	}
	return os.WriteFile(path, []byte(b.String()), 0o600)
}
