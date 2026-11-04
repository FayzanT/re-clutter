package gateway

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/google/uuid"
)

// LocalS3 answers the handful of S3 calls the Lambdas and the browser make,
// path-style, so generation, logs and uploads work with no AWS. Signatures are
// never checked: it serves loopback only, and its data is throwaway.
//
// The data bucket lives on disk under <dir>/<bucket>/<key>. The templates
// bucket is read-only and is served straight from the repo's files, using the
// key-to-source mapping in the platform Terraform, so a template edit shows up
// with no copy step and a file missing from that mapping is missing here too,
// as it would be in AWS.
type LocalS3 struct {
	logger    *log.Logger
	root      *os.Root
	templates map[string]string // S3 key -> source file
}

// uploadsDir holds objects while they are written, so a reader never sees half
// a file. It sits beside the buckets, not in one.
const uploadsDir = ".uploads"

// NewLocalS3 opens the store under dir and reads the templates bucket's
// mapping from the platform Terraform's s3 module.
func NewLocalS3(dir, s3ModuleDir string, logger *log.Logger) (*LocalS3, error) {
	templates, err := TemplateObjects(s3ModuleDir)
	if err != nil {
		return nil, err
	}
	for _, d := range []string{LocalDataBucket, uploadsDir} {
		if err := os.MkdirAll(filepath.Join(dir, d), 0o700); err != nil {
			return nil, err
		}
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, err
	}
	return &LocalS3{logger: logger, root: root, templates: templates}, nil
}

// Close releases the store.
func (s *LocalS3) Close() error {
	return s.root.Close()
}

var (
	s3ObjectStartRe = regexp.MustCompile(`resource\s+"aws_s3_object"`)
	s3ObjectBlockRe = regexp.MustCompile(`(?ms)^resource "aws_s3_object" "([^"]+)" \{(.*?)^\}`)
	s3ObjectBucket  = regexp.MustCompile(`(?m)^\s*bucket\s*=\s*aws_s3_bucket\.templates\.id\s*$`)
	s3ObjectKeyRe   = regexp.MustCompile(`(?m)^\s*key\s*=\s*"([^"$]+)"\s*$`)
	s3ObjectSrcRe   = regexp.MustCompile(`(?m)^\s*source\s*=\s*"\$\{path\.module\}/([^"]+)"\s*$`)
)

// TemplateObjects maps each aws_s3_object in <s3ModuleDir>/main.tf to its
// source file. Any object it cannot resolve is an error, so a change to the
// module fails the start-up loudly instead of surfacing as a missing template.
func TemplateObjects(s3ModuleDir string) (map[string]string, error) {
	raw, err := os.ReadFile(filepath.Join(s3ModuleDir, "main.tf"))
	if err != nil {
		return nil, err
	}
	blocks := s3ObjectBlockRe.FindAllStringSubmatch(string(raw), -1)
	if want := len(s3ObjectStartRe.FindAll(raw, -1)); want == 0 || want != len(blocks) {
		return nil, fmt.Errorf("%s has %d aws_s3_object blocks but %d parsed; update TemplateObjects", s3ModuleDir, want, len(blocks))
	}
	out := make(map[string]string, len(blocks))
	for _, b := range blocks {
		name, body := b[1], b[2]
		key, src := s3ObjectKeyRe.FindStringSubmatch(body), s3ObjectSrcRe.FindStringSubmatch(body)
		if key == nil || src == nil || !s3ObjectBucket.MatchString(body) {
			return nil, fmt.Errorf("aws_s3_object %q: want a literal key, a source under ${path.module} and the templates bucket", name)
		}
		file := filepath.Join(s3ModuleDir, filepath.FromSlash(src[1]))
		if info, err := os.Stat(file); err != nil || !info.Mode().IsRegular() {
			return nil, fmt.Errorf("aws_s3_object %q: source %s is not a file", name, src[1])
		}
		out[key[1]] = file
	}
	return out, nil
}

func splitBucketKey(urlPath string) (bucket, key string) {
	bucket, key, _ = strings.Cut(strings.TrimPrefix(urlPath, "/"), "/")
	return bucket, key
}

// handles reports whether a request is one of the S3 calls served here.
// Anything else stays with NoAWS and is refused: every other AWS protocol
// (JSON with X-Amz-Target, the query protocol's POST to /), an unknown bucket,
// and an S3 call this store does not implement, which must not pass as a
// plain GET or PUT.
func (s *LocalS3) handles(r *http.Request) bool {
	if r.Header.Get("X-Amz-Target") != "" || strings.HasPrefix(r.Header.Get("Content-Type"), "application/x-amz-json") {
		return false
	}
	bucket, key := splitBucketKey(r.URL.Path)
	if bucket != LocalDataBucket && bucket != LocalTemplateBucket {
		return false
	}
	query := r.URL.Query()
	if key == "" {
		return r.Method == http.MethodGet && query.Get("list-type") == "2"
	}
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodPut, http.MethodDelete, http.MethodOptions:
	default:
		return false
	}
	for name := range query {
		n := strings.ToLower(name)
		if n != "x-id" && !strings.HasPrefix(n, "x-amz-") && !strings.HasPrefix(n, "response-") {
			return false
		}
	}
	return true
}

func (s *LocalS3) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
	defer func() {
		s.logger.Printf("[local-s3] %s %s -> %d", r.Method, r.URL.Path, rec.status)
	}()

	allowed := setCORS(rec, r)
	if r.Method == http.MethodOptions {
		if !allowed {
			s3Error(rec, http.StatusForbidden, "AccessForbidden", "CORSResponse: this origin is not allowed")
			return
		}
		rec.Header().Set("Access-Control-Allow-Methods", "GET,PUT,DELETE,HEAD")
		rec.Header().Set("Access-Control-Allow-Headers", r.Header.Get("Access-Control-Request-Headers"))
		rec.Header().Set("Access-Control-Max-Age", "3000")
		rec.WriteHeader(http.StatusOK)
		return
	}

	bucket, key := splitBucketKey(r.URL.Path)
	if key == "" {
		s.list(rec, r, bucket)
		return
	}
	if !safeKey(key) {
		s3Error(rec, http.StatusBadRequest, "InvalidArgument", "the devserver refuses this key: empty, . or .. path segment")
		return
	}
	switch r.Method {
	case http.MethodGet, http.MethodHead:
		s.get(rec, r, bucket, key)
	case http.MethodPut:
		s.put(rec, r, bucket, key)
	case http.MethodDelete:
		s.delete(rec, bucket, key)
	}
}

// setCORS allows any origin on loopback, the only place the frontend runs
// locally, and reports whether the request's origin was allowed.
func setCORS(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	u, err := url.Parse(origin)
	if origin == "" || err != nil || !isLoopbackHost(u.Hostname()) {
		return false
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Expose-Headers", "ETag")
	w.Header().Add("Vary", "Origin")
	return true
}

// safeKey refuses keys that are legal in S3 but not as a path on disk. Keys
// carry canvas values (a Lambda name, a playbook file name).
func safeKey(key string) bool {
	for _, seg := range strings.Split(key, "/") {
		if seg == "" || seg == "." || seg == ".." {
			return false
		}
	}
	return true
}

func notFound(err error) bool {
	return errors.Is(err, fs.ErrNotExist) || errors.Is(err, syscall.ENOTDIR)
}

func (s *LocalS3) get(w http.ResponseWriter, r *http.Request, bucket, key string) {
	var f fs.File
	var err error
	if bucket == LocalTemplateBucket {
		source, ok := s.templates[key]
		if !ok {
			s3Error(w, http.StatusNotFound, "NoSuchKey", "The specified key does not exist.")
			return
		}
		f, err = os.Open(source)
	} else {
		f, err = s.root.Open(bucket + "/" + key)
	}
	if notFound(err) {
		s3Error(w, http.StatusNotFound, "NoSuchKey", "The specified key does not exist.")
		return
	}
	if err != nil {
		s3Error(w, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		s3Error(w, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	if info.IsDir() {
		s3Error(w, http.StatusNotFound, "NoSuchKey", "The specified key does not exist.")
		return
	}
	content := f.(io.ReadSeeker)
	sum := md5.New()
	if _, err := io.Copy(sum, content); err != nil {
		s3Error(w, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	if _, err := content.Seek(0, io.SeekStart); err != nil {
		s3Error(w, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	contentType := mime.TypeByExtension(path.Ext(key))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("ETag", `"`+hex.EncodeToString(sum.Sum(nil))+`"`)
	http.ServeContent(w, r, "", info.ModTime(), content)
}

func (s *LocalS3) put(w http.ResponseWriter, r *http.Request, bucket, key string) {
	if bucket == LocalTemplateBucket {
		s3Error(w, http.StatusForbidden, "AccessDenied", "the templates bucket is read-only here; edit the file in backend/infra/modules/s3/uploads")
		return
	}
	// The body of a streaming upload is framed in chunks. Storing the frames
	// would corrupt the object, so refuse rather than guess.
	if strings.Contains(r.Header.Get("Content-Encoding"), "aws-chunked") || strings.HasPrefix(r.Header.Get("X-Amz-Content-Sha256"), "STREAMING-") {
		s3Error(w, http.StatusNotImplemented, "NotImplemented", "the devserver does not decode aws-chunked uploads")
		return
	}

	tmp := uploadsDir + "/" + uuid.NewString()
	f, err := s.root.Create(tmp)
	if err != nil {
		s3Error(w, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	defer func() { _ = s.root.Remove(tmp) }() // fails harmlessly once renamed
	sum := md5.New()
	_, err = io.Copy(io.MultiWriter(f, sum), r.Body)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		target := bucket + "/" + key
		if err = s.root.MkdirAll(path.Dir(target), 0o700); err == nil {
			err = s.root.Rename(tmp, target)
		}
	}
	if err != nil {
		s3Error(w, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	w.Header().Set("ETag", `"`+hex.EncodeToString(sum.Sum(nil))+`"`)
	w.WriteHeader(http.StatusOK)
}

func (s *LocalS3) delete(w http.ResponseWriter, bucket, key string) {
	if bucket == LocalTemplateBucket {
		s3Error(w, http.StatusForbidden, "AccessDenied", "the templates bucket is read-only here")
		return
	}
	// As in S3, deleting a key that does not exist succeeds.
	if err := s.root.Remove(bucket + "/" + key); err != nil && !notFound(err) {
		s3Error(w, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type s3Object struct {
	key      string
	size     int64
	modified time.Time
}

// objects returns every object in a bucket, sorted by key.
func (s *LocalS3) objects(bucket string) ([]s3Object, error) {
	var out []s3Object
	if bucket == LocalTemplateBucket {
		for key, source := range s.templates {
			info, err := os.Stat(source)
			if err != nil {
				return nil, err
			}
			out = append(out, s3Object{key: key, size: info.Size(), modified: info.ModTime()})
		}
	} else {
		err := fs.WalkDir(s.root.FS(), bucket, func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			info, err := d.Info()
			if err != nil {
				return err
			}
			out = append(out, s3Object{key: strings.TrimPrefix(p, bucket+"/"), size: info.Size(), modified: info.ModTime()})
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].key < out[j].key })
	return out, nil
}

type listEntry struct {
	Key          string
	LastModified string
	Size         int64
}

type listPrefix struct {
	Prefix string
}

// listResult is the ListObjectsV2 response.
type listResult struct {
	XMLName               xml.Name `xml:"ListBucketResult"`
	Xmlns                 string   `xml:"xmlns,attr"`
	Name                  string
	Prefix                string
	Delimiter             string `xml:",omitempty"`
	KeyCount              int
	MaxKeys               int
	IsTruncated           bool
	NextContinuationToken string       `xml:",omitempty"`
	Contents              []listEntry  `xml:",omitempty"`
	CommonPrefixes        []listPrefix `xml:",omitempty"`
}

func (s *LocalS3) list(w http.ResponseWriter, r *http.Request, bucket string) {
	q := r.URL.Query()
	prefix, delimiter := q.Get("prefix"), q.Get("delimiter")
	after := q.Get("continuation-token")
	if after == "" {
		after = q.Get("start-after")
	}
	maxKeys := 1000
	if v, err := strconv.Atoi(q.Get("max-keys")); err == nil && v >= 0 && v < maxKeys {
		maxKeys = v
	}
	objects, err := s.objects(bucket)
	if err != nil {
		s3Error(w, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}

	out := listResult{Xmlns: "http://s3.amazonaws.com/doc/2006-03-01/", Name: bucket, Prefix: prefix, Delimiter: delimiter, MaxKeys: maxKeys}
	last, lastPrefix := "", ""
	for _, o := range objects {
		if !strings.HasPrefix(o.key, prefix) || o.key <= after {
			continue
		}
		// A token that is a common prefix stands for every key beneath it.
		if delimiter != "" && strings.HasSuffix(after, delimiter) && strings.HasPrefix(o.key, after) {
			continue
		}
		common := ""
		if delimiter != "" {
			if i := strings.Index(o.key[len(prefix):], delimiter); i >= 0 {
				common = o.key[:len(prefix)+i+len(delimiter)]
			}
		}
		if common != "" && common == lastPrefix {
			continue
		}
		if out.KeyCount == maxKeys {
			out.IsTruncated, out.NextContinuationToken = true, last
			break
		}
		out.KeyCount++
		if common != "" {
			out.CommonPrefixes = append(out.CommonPrefixes, listPrefix{Prefix: common})
			last, lastPrefix = common, common
			continue
		}
		out.Contents = append(out.Contents, listEntry{Key: o.key, LastModified: o.modified.UTC().Format("2006-01-02T15:04:05.000Z"), Size: o.size})
		last = o.key
	}

	body, err := xml.Marshal(out)
	if err != nil {
		s3Error(w, http.StatusInternalServerError, "InternalError", err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/xml")
	_, _ = io.WriteString(w, xml.Header)
	_, _ = w.Write(body)
}

// s3Error writes an error in S3's REST-XML form.
func s3Error(w http.ResponseWriter, status int, code, message string) {
	body, err := xml.Marshal(struct {
		XMLName xml.Name `xml:"Error"`
		Code    string
		Message string
	}{Code: code, Message: message})
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/xml")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, xml.Header)
	_, _ = w.Write(body)
}
