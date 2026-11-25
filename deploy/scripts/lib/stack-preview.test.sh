#!/usr/bin/env bash
# Exercise the real deployment entry points without production Docker mutations.
# @package @vxture/repo
# @layer Infrastructure
# @category test
# @author AI-Generated
# @date 2026-11-23
set -euo pipefail
LIB_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(cd "$LIB_DIR/../.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/vx-stack-preview-test.XXXXXXXX")"
trap '[[ -n "$fixture" && -d "$fixture/scripts" ]] && rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/"{bin,scripts/lib,guardrails,runtime/secrets,tmp}
cp "$DEPLOY/scripts/30-deploy-platform-stack.sh" "$DEPLOY/scripts/31-regular-upgrade-platform.sh" "$fixture/scripts/"
cp "$LIB_DIR/"{compose-env.sh,nginx-idp-port.sh,pin-image-digests.sh,prune-images.sh,env-values.sh} "$fixture/scripts/lib/"
printf 'services: {}\n' > "$fixture/compose.platform.yml"
printf 'previous-pin\n' > "$fixture/compose.pinned.yml"
printf 'previous-release\n' > "$fixture/runtime/.last-deploy-tag"
printf 'process.exit(0);\n' > "$fixture/guardrails/39-audit-env.mjs"
cat > "$fixture/runtime/.env" <<'ENV'
VX_IMAGE_REGISTRY=registry.example.test
VX_IMAGE_NAMESPACE=platform
VX_IMAGE_TAG=preview-test
VX_WORKER01_TAILNET_IP=203.0.113.1
VX_WORKER02_TAILNET_IP=203.0.113.2
ENV
for name in auth-bff gateway-bff website-bff console-bff admin-bff opera-bff arche-bff workbench workbench-bff platform-api; do
  printf '# synthetic fixture\n' > "$fixture/runtime/.env.$name"
done
cat >> "$fixture/runtime/.env.auth-bff" <<'ENV'
COOKIE_DOMAIN_PLATFORM=example.test
ALIYUN_CAPTCHA_ENABLED=true
ALIYUN_CAPTCHA_ACCESS_KEY_ID=synthetic-key
ALIYUN_CAPTCHA_ACCESS_KEY_SECRET=synthetic-secret-never-print
ALIYUN_CAPTCHA_PREFIX=synthetic
ALIYUN_CAPTCHA_CUSTOMER_SCENE_ID=customer
ALIYUN_CAPTCHA_WORKFORCE_SCENE_ID=workforce
ALIYUN_CAPTCHA_REGION=cn
ENV
for name in tair-pw-default platform.env platform-mail.env platform-sms.env platform-identity.env platform-app.env platform-idp-internal.env; do
  printf '# synthetic fixture\n' > "$fixture/runtime/secrets/$name"
done
for key in ALIYUN_SMS_SCHEME_NAME ALIYUN_SMS_CUSTOMER_LOGIN_SCHEME_NAME ALIYUN_SMS_CUSTOMER_REGISTER_SCHEME_NAME ALIYUN_SMS_CUSTOMER_SOCIAL_BIND_SCHEME_NAME ALIYUN_SMS_WORKFORCE_LOGIN_SCHEME_NAME ALIYUN_SMS_WORKFORCE_PHONE_CHANGE_SCHEME_NAME ALIYUN_SMS_CUSTOMER_SECURITY_SCHEME_NAME ALIYUN_SMS_CUSTOMER_PHONE_CHANGE_SCHEME_NAME; do
  printf '%s=s%s\n' "$key" "$(wc -l < "$fixture/runtime/secrets/platform-sms.env" | tr -d ' ')" >> "$fixture/runtime/secrets/platform-sms.env"
done
for name in 13-prepare-runtime-env.sh 20-sync-nginx-config.sh 21-prepare-platform-database.sh 40-verify-platform-runtime.sh; do
  printf '#!/usr/bin/env bash\nprintf "%%s\\n" "%s" >> "$STACK_PREVIEW_FIXTURE/steps"\n' "$name" > "$fixture/scripts/$name"
done
cat > "$fixture/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$STACK_PREVIEW_FIXTURE/calls"
case "$*" in
  'compose --help')
    [[ "${STACK_PREVIEW_MODE:-}" != unsupported ]] || exit 0
    echo 'Options: --dry-run';;
  'compose -f '*'/compose.platform.yml config --format json')
    [[ "${STACK_PREVIEW_MODE:-}" != config-failure ]] || { echo 'synthetic-secret-never-print' >&2; exit 62; }
    [[ "${STACK_PREVIEW_MODE:-}" != malformed ]] || { echo '{bad json'; exit 0; }
    [[ "${STACK_PREVIEW_MODE:-}" != incomplete ]] || { echo '{"services":{}}'; exit 0; }
    printf '{"services":{"auth-bff":{"image":"registry.example.test/platform/auth:preview-test"},"workbench-bff":{"image":"registry.example.test/platform/workbench:preview-test"}}}\n';;
  'buildx imagetools inspect '*--raw)
    [[ "${STACK_PREVIEW_MODE:-}" != image-failure ]] || exit 1
    printf '{"manifests":[{"platform":{"architecture":"amd64","os":"linux"},"digest":"sha256:%064d"}]}\n' 1;;
  'compose --dry-run '*)
    # Inspect only the temporary pin file; a real apply command is never accepted.
    previous=''
    for arg in "$@"; do
      if [[ "$previous" == -f && "$arg" != "$STACK_PREVIEW_FIXTURE/compose.platform.yml" ]]; then
        cp "$arg" "$STACK_PREVIEW_FIXTURE/preview-pin"
        printf '%s\n' "$arg" > "$STACK_PREVIEW_FIXTURE/preview-pin-path"
      fi
      previous="$arg"
    done
    echo 'synthetic-secret-never-print' >&2
    [[ "${STACK_PREVIEW_MODE:-}" != preview-failure ]] || exit 73
    [[ "${STACK_PREVIEW_MODE:-}" != empty-preview ]] || exit 0
    if [[ "${STACK_PREVIEW_MODE:-}" == config-change ]]; then
      echo ' Container vx-platform-auth-bff Recreate ' >&2
      echo ' Container vx-platform-auth-bff Recreated ' >&2
    else
      echo ' Container vx-platform-auth-bff Running ' >&2
    fi;;
  *) echo 'Rejected non-preview Docker action' >&2; exit 99;;
esac
DOCKER
chmod +x "$fixture/bin/docker"
export STACK_PREVIEW_FIXTURE="$fixture" PATH="$fixture/bin:$PATH" RUNTIME_DIR="$fixture/runtime" TMPDIR="$fixture/tmp"
unset VX_IMAGE_REGISTRY VX_IMAGE_NAMESPACE VX_IMAGE_TAG VX_WORKER01_TAILNET_IP VX_WORKER02_TAILNET_IP || true
script30="$fixture/scripts/30-deploy-platform-stack.sh"
script31="$fixture/scripts/31-regular-upgrade-platform.sh"
count=0
passed() { count=$((count+1)); printf 'ok %s - %s\n' "$count" "$1"; }
run_ok() { "$@" > "$fixture/output" 2>&1 || { cat "$fixture/output"; exit 1; }; }
run_bad() {
  if "$@" > "$fixture/output" 2>&1; then echo 'Expected preview rejection'; exit 1;
  else last_status=$?; fi
}
unchanged() {
  [[ "$(cat "$fixture/compose.pinned.yml")" == previous-pin ]]
  [[ "$(cat "$fixture/runtime/.last-deploy-tag")" == previous-release ]]
  ! grep -q 'synthetic-secret-never-print' "$fixture/output"
}
no_diagnostics() { [[ -z "$(find "$fixture/tmp" -mindepth 1 -print -quit)" ]]; }
failure_diagnostics() {
  local directory
  directory="$(find "$fixture/tmp" -mindepth 1 -maxdepth 1 -type d)"
  [[ -n "$directory" && "$directory" == "$fixture/tmp/vx-stack-plan."* ]]
  grep -Fq "Private diagnostics retained in $directory" "$fixture/output"
  [[ "$(stat -c %a "$directory")" == 700 ]]
  [[ -z "$(find "$directory" -type f ! -perm 600 -print -quit)" ]]
  case "${STACK_PREVIEW_MODE:-}" in
    config-failure) grep -q 'synthetic-secret-never-print' "$directory/config.stderr" ;;
    preview-failure) grep -q 'synthetic-secret-never-print' "$directory/preview.log" ;;
  esac
  rm -rf -- "$directory"
}

# ============================================================================
# Real preview entry: complete pinning, configuration drift and failure safety.
# ============================================================================
run_ok bash "$script30" --preview
grep -q '\[preview\] Container vx-platform-auth-bff Running' "$fixture/output"
[[ "$(grep -c 'image: registry.example.test/platform/.*@sha256:' "$fixture/preview-pin")" == 2 ]]
[[ ! -e "$(cat "$fixture/preview-pin-path")" ]]
unchanged
no_diagnostics
passed 'read-only preview resolves every image without changing deployed files'

STACK_PREVIEW_MODE=config-change run_ok bash "$script30" --preview
grep -q '\[preview\] Container vx-platform-auth-bff Recreate' "$fixture/output"
unchanged
no_diagnostics
passed 'same pinned images still expose configuration-driven recreation from stderr'

for mode in unsupported config-failure preview-failure malformed incomplete image-failure empty-preview; do
  STACK_PREVIEW_MODE="$mode" run_bad bash "$script30" --preview
  case "$mode" in config-failure) [[ "$last_status" == 1 ]] ;; preview-failure) [[ "$last_status" == 73 ]] ;; esac
  unchanged
  STACK_PREVIEW_MODE="$mode" failure_diagnostics
done
passed 'failed plans retain private diagnostics without leaking secrets or changing the stack'

rm -f "$fixture/calls"
run_bad bash "$script30" --preview extra
[[ ! -e "$fixture/calls" ]]
run_bad bash "$script30" --apply
[[ ! -e "$fixture/calls" ]]
passed 'unknown or extra arguments are rejected before Docker'

# ============================================================================
# Upgrade entry: explicit preview bypasses preparation; failure blocks routing.
# ============================================================================
run_ok bash "$script31" --preview
[[ ! -e "$fixture/steps" ]]
unchanged
no_diagnostics
passed 'upgrade preview bypasses runtime preparation, routing, database and deploy steps'

STACK_PREVIEW_MODE=preview-failure run_bad bash "$script31"
[[ "$(cat "$fixture/steps")" == 13-prepare-runtime-env.sh ]]
unchanged
STACK_PREVIEW_MODE=preview-failure failure_diagnostics
passed 'normal upgrade stops before any routing or service change when preview fails'

run_bad bash "$script31" --preview extra
[[ "$(cat "$fixture/steps")" == 13-prepare-runtime-env.sh ]]
passed 'upgrade entry never silently interprets unsupported arguments'
