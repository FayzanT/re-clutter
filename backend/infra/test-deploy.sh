#!/usr/bin/env bash
# Tests deploy.sh's safety checks with fake terraform, aws and git, so nothing reaches AWS.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pass=0; fail=0
T="$(mktemp -d)"
trap 'rm -rf "${T}"' EXIT
mkdir -p "${T}/bin" "${T}/infra"

cat > "${T}/bin/terraform" <<'EOF'
#!/usr/bin/env bash
echo "terraform $*" >> "${FAKE_LOG}"
EOF
cat > "${T}/bin/aws" <<'EOF'
#!/usr/bin/env bash
[[ -n "${FAKE_ACCOUNT:-}" ]] || exit 1
echo "${FAKE_ACCOUNT}"
EOF
cat > "${T}/bin/git" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *rev-parse*) echo "${FAKE_BRANCH:-main}" ;;
  *status*) echo "${FAKE_DIRTY:-}" ;;
esac
EOF
printf '#!/usr/bin/env bash\necho "build" >> "${FAKE_LOG}"\n' > "${T}/bin/build"
chmod +x "${T}/bin/"*

write_config() { # environment
  printf 'clutter_account_id = "111122223333"\nfrontend_url = "https://clutter.test"\n' > "${T}/infra/$1.tfvars"
  printf 'bucket = "tfstate-real"\n' > "${T}/infra/$1.backend.hcl"
}

# run <input> <args...>: runs deploy.sh with the fakes; output in $out, exit code in $code.
run() {
  local input="$1"; shift
  : > "${T}/log"
  out="$(printf '%s\n' "${input}" | PATH="${T}/bin:${PATH}" FAKE_LOG="${T}/log" CLUTTER_INFRA_DIR="${T}/infra" CLUTTER_BUILD_CMD="${T}/bin/build" "${HERE}/deploy.sh" "$@" 2>&1)"
  code=$?
}
applied() { grep -qE "^terraform .* apply " "${T}/log"; }

check() { # name, condition
  if eval "$2"; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "FAIL: $1 (exit ${code}): ${out}"; fi
}

export FAKE_ACCOUNT=111122223333

run "" ;                      check "no arguments is refused" '[ $code -ne 0 ]'
run "" apply staging;         check "unknown environment is refused" '[ $code -ne 0 ]'
run "" destroy prod;          check "destroying prod is refused" '[ $code -ne 0 ] && ! applied'
run "" apply dev;             check "missing config is refused" '[ $code -ne 0 ] && [[ "$out" == *"missing dev.tfvars"* ]]'

write_config dev
printf 'jwt_secret = "REPLACE_WITH_A_LONG_RANDOM_STRING"\n' >> "${T}/infra/dev.tfvars"
run "" apply dev;             check "example values are refused" '[ $code -ne 0 ] && [[ "$out" == *"example values"* ]]'

write_config dev
FAKE_ACCOUNT=999999999999 run "" apply dev
check "wrong AWS account is refused" '[ $code -ne 0 ] && [[ "$out" == *"account 999999999999"* ]] && ! applied'
FAKE_ACCOUNT="" run "" apply dev
check "not logged in is refused" '[ $code -ne 0 ] && [[ "$out" == *"not logged in"* ]]'

run "" plan dev
check "plan changes nothing" '[ $code -eq 0 ] && grep -qE "^terraform .* plan " "${T}/log" && ! applied'
check "plan uses the environment files" 'grep -q "backend-config=dev.backend.hcl" "${T}/log" && grep -q "var-file=dev.tfvars" "${T}/log"'

run "no" apply dev;           check "a wrong answer applies nothing" '[ $code -ne 0 ] && ! applied'
run "dev" apply dev;          check "the right answer applies" '[ $code -eq 0 ] && applied'
run "dev" destroy dev;        check "destroy plans a teardown" '[ $code -eq 0 ] && grep -q -- "-destroy" "${T}/log" && applied'

write_config prod
FAKE_BRANCH=feature run "prod" apply prod
check "prod only from main" '[ $code -ne 0 ] && ! applied'
FAKE_DIRTY="M file" run "prod" apply prod
check "prod only from a clean checkout" '[ $code -ne 0 ] && ! applied'
run "dev" apply prod;         check "prod needs the word prod" '[ $code -ne 0 ] && ! applied'
run "prod" apply prod;        check "prod applies from clean main" '[ $code -eq 0 ] && applied'

echo "deploy checks: ${pass} passed, ${fail} failed"
[ "${fail}" -eq 0 ]
