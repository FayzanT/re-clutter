package routes

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// The test reads the platform Terraform and the API source tree from the repo.
const (
	mainTFPath = "../../../infra/main.tf"
	apiDir     = "../../../api"
)

type tfBlock struct {
	name  string
	attrs map[string]string // top-level `key = value` lines, raw value
	env   []string          // keys of environment_variables, if any
	body  string
}

var (
	moduleRe  = regexp.MustCompile(`(?ms)^module "([^"]+)" \{\n(.*?)^\}`)
	attrRe    = regexp.MustCompile(`^\s*([a-z_]+)\s*=\s*(.+?)\s*$`)
	envOpenRe = regexp.MustCompile(`^\s*environment_variables\s*=\s*\{\s*(\}\s*)?$`)
	envKeyRe  = regexp.MustCompile(`^\s*([A-Z0-9_]+)\s*=`)
	stringRe  = regexp.MustCompile(`^"([^"]*)"$`)
	refRe     = regexp.MustCompile(`^module\.([A-Za-z0-9_-]+)\.([a-z_]+)$`)
	listItem  = regexp.MustCompile(`"([^"]+)"`)
)

func parseMainTF(t *testing.T) map[string]tfBlock {
	t.Helper()
	raw, err := os.ReadFile(mainTFPath)
	if err != nil {
		t.Fatalf("read %s: %v", mainTFPath, err)
	}
	blocks := map[string]tfBlock{}
	for _, m := range moduleRe.FindAllStringSubmatch(string(raw), -1) {
		b := tfBlock{name: m[1], attrs: map[string]string{}, body: m[2]}
		inEnv := false
		for _, line := range strings.Split(m[2], "\n") {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "//") {
				continue
			}
			if inEnv {
				if trimmed == "}" {
					inEnv = false
					continue
				}
				if km := envKeyRe.FindStringSubmatch(line); km != nil {
					b.env = append(b.env, km[1])
				}
				continue
			}
			if em := envOpenRe.FindStringSubmatch(line); em != nil {
				inEnv = em[1] == ""
				b.attrs["environment_variables"] = "{}"
				continue
			}
			if am := attrRe.FindStringSubmatch(line); am != nil {
				b.attrs[am[1]] = am[2]
			}
		}
		if _, dup := blocks[b.name]; dup {
			t.Fatalf("module %q declared twice in main.tf", b.name)
		}
		blocks[b.name] = b
	}
	if len(blocks) == 0 {
		t.Fatalf("no module blocks parsed from %s", mainTFPath)
	}
	return blocks
}

func unquote(v string) (string, bool) {
	m := stringRe.FindStringSubmatch(v)
	if m == nil {
		return "", false
	}
	return m[1], true
}

func moduleRef(v string) (module, output string, ok bool) {
	m := refRe.FindStringSubmatch(v)
	if m == nil {
		return "", "", false
	}
	return m[1], m[2], true
}

// resolvePath walks api-path modules up to the API root.
func resolvePath(t *testing.T, blocks map[string]tfBlock, module string) string {
	t.Helper()
	var parts []string
	for depth := 0; depth < 20; depth++ {
		b, ok := blocks[module]
		if !ok || b.attrs["source"] != `"./modules/templates/api-path"` {
			t.Fatalf("resource_id points at %q, which is not an api-path module", module)
		}
		part, ok := unquote(b.attrs["path_part"])
		if !ok {
			t.Fatalf("api-path module %q has no literal path_part", module)
		}
		parts = append([]string{part}, parts...)
		parent, out, ok := moduleRef(b.attrs["parent_id"])
		if !ok {
			t.Fatalf("api-path module %q has an unexpected parent_id %q", module, b.attrs["parent_id"])
		}
		if parent == "clutter-api-gateway" && out == "root_resource_id" {
			return "/" + strings.Join(parts, "/")
		}
		module = parent
	}
	t.Fatalf("api-path chain from %q is too deep", module)
	return ""
}

func TestLambdasMatchMainTF(t *testing.T) {
	blocks := parseMainTF(t)

	got := map[string]Lambda{}
	for _, b := range blocks {
		if b.attrs["source"] != `"./modules/templates/lambda"` {
			continue
		}
		name, ok := unquote(b.attrs["function_name"])
		if !ok {
			t.Fatalf("lambda module %q has no literal function_name", b.name)
		}
		dir, ok := unquote(b.attrs["zip_dir_slice"])
		if !ok {
			t.Fatalf("lambda module %q has no literal zip_dir_slice", b.name)
		}
		timeout := 3
		if v, ok := b.attrs["timeout"]; ok {
			n, err := strconv.Atoi(v)
			if err != nil {
				t.Fatalf("lambda module %q timeout %q: %v", b.name, v, err)
			}
			timeout = n
		}
		env := append([]string(nil), b.env...)
		sort.Strings(env)
		got[name] = Lambda{Name: name, Dir: dir, TimeoutSeconds: timeout, EnvKeys: env}
	}

	skipped := map[string]bool{}
	for _, s := range SkippedLambdas {
		skipped[s] = true
		if _, ok := got[s]; !ok {
			t.Errorf("SkippedLambdas names %q, which main.tf does not define", s)
		}
	}

	want := map[string]Lambda{}
	for _, l := range Lambdas {
		if _, dup := want[l.Name]; dup {
			t.Errorf("Lambdas lists %q twice", l.Name)
		}
		env := append([]string(nil), l.EnvKeys...)
		sort.Strings(env)
		l.EnvKeys = env
		want[l.Name] = l
	}

	for name, g := range got {
		if skipped[name] {
			continue
		}
		w, ok := want[name]
		if !ok {
			t.Errorf("main.tf defines Lambda %q (dir %s); add it to Lambdas or SkippedLambdas", name, g.Dir)
			continue
		}
		if w.Dir != g.Dir {
			t.Errorf("Lambda %q: dir is %q in main.tf, %q here", name, g.Dir, w.Dir)
		}
		if w.TimeoutSeconds != g.TimeoutSeconds {
			t.Errorf("Lambda %q: timeout is %d in main.tf, %d here", name, g.TimeoutSeconds, w.TimeoutSeconds)
		}
		if strings.Join(w.EnvKeys, ",") != strings.Join(g.EnvKeys, ",") {
			t.Errorf("Lambda %q: env keys are %v in main.tf, %v here", name, g.EnvKeys, w.EnvKeys)
		}
	}
	for name := range want {
		if _, ok := got[name]; !ok {
			t.Errorf("Lambdas lists %q, which main.tf does not define", name)
		}
	}

	// Every Lambda directory must hold a main.go the gateway can build.
	for _, l := range Lambdas {
		if _, err := os.Stat(filepath.Join(apiDir, l.Dir, "main.go")); err != nil {
			t.Errorf("Lambda %q: %v", l.Name, err)
		}
	}
}

func TestRoutesMatchMainTF(t *testing.T) {
	blocks := parseMainTF(t)

	// Map lambda module name -> function_name, for integration references.
	fnByModule := map[string]string{}
	for _, b := range blocks {
		if b.attrs["source"] == `"./modules/templates/lambda"` {
			name, _ := unquote(b.attrs["function_name"])
			fnByModule[b.name] = name
		}
	}

	key := func(method, path string) string { return method + " " + path }

	got := map[string]Route{}
	for _, b := range blocks {
		if b.attrs["source"] != `"./modules/templates/api-lambda-integration"` {
			continue
		}
		method, ok := unquote(b.attrs["http_method"])
		if !ok {
			t.Fatalf("integration %q has no literal http_method", b.name)
		}
		resModule, _, ok := moduleRef(b.attrs["resource_id"])
		if !ok {
			t.Fatalf("integration %q has an unexpected resource_id", b.name)
		}
		fnModule, _, ok := moduleRef(b.attrs["function_name"])
		if !ok {
			t.Fatalf("integration %q has an unexpected function_name", b.name)
		}
		fn, ok := fnByModule[fnModule]
		if !ok {
			t.Fatalf("integration %q points at %q, which is not a lambda module", b.name, fnModule)
		}
		_, hasAuth := b.attrs["jwt_authorizer_id"]
		r := Route{Method: method, Path: resolvePath(t, blocks, resModule), Lambda: fn, Authorized: hasAuth}
		k := key(r.Method, r.Path)
		if _, dup := got[k]; dup {
			t.Fatalf("main.tf integrates %s twice", k)
		}
		got[k] = r
	}

	want := map[string]Route{}
	for _, r := range Routes {
		k := key(r.Method, r.Path)
		if _, dup := want[k]; dup {
			t.Errorf("Routes lists %s twice", k)
		}
		want[k] = r
		if _, ok := LambdaByName(r.Lambda); !ok {
			t.Errorf("route %s uses Lambda %q, which is not in Lambdas", k, r.Lambda)
		}
	}

	if len(got) != 32 {
		t.Errorf("main.tf has %d integrations; the devserver was written for 32", len(got))
	}
	for k, g := range got {
		w, ok := want[k]
		if !ok {
			t.Errorf("main.tf integrates %s -> %s (authorizer %v); Routes is missing it", k, g.Lambda, g.Authorized)
			continue
		}
		if w != g {
			t.Errorf("route %s differs: main.tf %+v, Routes %+v", k, g, w)
		}
	}
	for k := range want {
		if _, ok := got[k]; !ok {
			t.Errorf("Routes lists %s, which main.tf does not integrate", k)
		}
	}
}

func TestCORSMatchesMainTF(t *testing.T) {
	blocks := parseMainTF(t)
	got := map[string][]string{}
	for _, b := range blocks {
		if b.attrs["source"] != `"./modules/templates/api-path-cors-compliance"` {
			continue
		}
		resModule, _, ok := moduleRef(b.attrs["resource_id"])
		if !ok {
			t.Fatalf("cors module %q has an unexpected resource_id", b.name)
		}
		var methods []string
		for _, m := range listItem.FindAllStringSubmatch(b.attrs["http_methods"], -1) {
			methods = append(methods, m[1])
		}
		path := resolvePath(t, blocks, resModule)
		if _, dup := got[path]; dup {
			t.Fatalf("two cors modules for %s", path)
		}
		got[path] = methods
	}
	if fmt.Sprint(sortedKeys(got)) != fmt.Sprint(sortedKeys(CORS)) {
		t.Errorf("CORS paths differ:\n main.tf %v\n here    %v", sortedKeys(got), sortedKeys(CORS))
	}
	for path, methods := range got {
		if strings.Join(methods, ",") != strings.Join(CORS[path], ",") {
			t.Errorf("CORS %s: main.tf %v, here %v", path, methods, CORS[path])
		}
	}
	raw, err := os.ReadFile("../../../infra/modules/templates/api-path-cors-compliance/main.tf")
	if err != nil {
		t.Fatalf("read cors module: %v", err)
	}
	if !strings.Contains(string(raw), "'"+CORSAllowHeaders+"'") {
		t.Errorf("the cors module no longer returns Access-Control-Allow-Headers %q", CORSAllowHeaders)
	}
}

func sortedKeys(m map[string][]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
