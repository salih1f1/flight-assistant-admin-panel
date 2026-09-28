# shellcheck shell=bash disable=SC2034 # the constants are used by the scripts that source this
# Shared by scripts/resume-panel.sh and scripts/pause-panel.sh. Sourced, not run.
#
# Written for the bash that ships with macOS (3.2): no associative arrays, no ${x,,}, no mapfile,
# and date handling that works with both BSD and GNU date.

# --- What the scripts act on -----------------------------------------------------------------------

SUB_ID="a39b9c33-675b-40ca-84fc-6e548ef6d6c5"   # subscription "flight-assistant"
TENANT_ID="967285b3-fe6f-48ae-b2b9-d9b136222022" # the subscription's tenant (not the CIAM one)
RG="flight-assistant-dev"
PLAN="ASP-flightassistantdev-88a9"               # shared by the panel and the API
APP="flight-assistant-dev-panel"
API_APP="flight-assistant-dev-api"
PANEL_URL="https://${APP}.azurewebsites.net"
REPO="salih1f1/flight-assistant-admin-panel"
DEPLOY_WORKFLOW_ID="362302398"                   # .github/workflows/deploy.yml, "Deploy panel"

# The encrypted backup kit: hdiutil attach <image> mounts it here.
KIT_IMAGE="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Projects/Development/FlightAssistant/Azure-Pause-2026-09/fa-pause.sparseimage"
KIT_MOUNT="${FA_KIT_MOUNT:-/Volumes/FA-Pause}"   # override only for testing
KIT_LOG="$KIT_MOUNT/LOG.md"
KIT_EXPORT="$KIT_MOUNT/01-azure-export"

# --- Mode ------------------------------------------------------------------------------------------

MODE="dry-run"   # dry-run | apply | guided
WARNINGS=0
CHANGES=0

parse_mode() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --apply) [ "$MODE" = "guided" ] || MODE="apply" ;;
      --guided) MODE="guided" ;;
      -h|--help) usage; exit 0 ;;
      *) echo "Unknown option: $arg" >&2; usage >&2; exit 2 ;;
    esac
  done
}

# True when the script is allowed to change things (--apply or --guided).
applying() { [ "$MODE" != "dry-run" ]; }

# --- Output ----------------------------------------------------------------------------------------

if [ -t 1 ]; then
  C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_RED=$'\033[31m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_RESET=$'\033[0m'
else
  C_BOLD=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_RESET=""
fi

STEP_NO=0

# step "Title" "Why this step exists / what it changes" — the explanation is printed in --guided and
# dry-run mode; --apply keeps the output to the title and the results.
step() {
  STEP_NO=$((STEP_NO + 1))
  printf '\n%s== %d. %s ==%s\n' "$C_BOLD" "$STEP_NO" "$1" "$C_RESET"
  if [ "$MODE" != "apply" ] && [ -n "${2:-}" ]; then
    printf '%s%s%s\n' "$C_DIM" "$2" "$C_RESET" | fold -s -w 100
  fi
}

ok()   { printf '  %sok%s    %s\n' "$C_GREEN" "$C_RESET" "$*"; }
info() { printf '  ..    %s\n' "$*"; }
warn() { WARNINGS=$((WARNINGS + 1)); printf '  %sWARN%s  %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
fail() { printf '  %sFAIL%s  %s\n' "$C_RED" "$C_RESET" "$*" >&2; }
die()  { fail "$*"; exit 1; }

# The command as a copy-pasteable line.
quote_cmd() {
  local out="" a
  for a in "$@"; do out="$out $(printf '%q' "$a")"; done
  printf '%s' "${out# }"
}

# confirm "Question" — always yes in --apply, asks in --guided. Reads from the terminal so it still
# works when the script's stdin is redirected; without a terminal it reads stdin, and no answer is no.
confirm() {
  [ "$MODE" = "guided" ] || return 0
  local answer
  printf '  %s?%s     %s [y/N] ' "$C_BOLD" "$C_RESET" "$1"
  { read -r answer </dev/tty; } 2>/dev/null || read -r answer || answer=""
  case "$answer" in y|Y|yes|YES) return 0 ;; *) info "skipped"; return 1 ;; esac
}

# run CMD... — prints the command; runs it only in --apply/--guided. Returns the command's status.
run() {
  if applying; then
    printf '  %s$%s     %s\n' "$C_DIM" "$C_RESET" "$(quote_cmd "$@")"
    "$@"
  else
    printf '  would %s\n' "$(quote_cmd "$@")"
  fi
}

# change "Step name" "Undo command" CMD... — one change to Azure or GitHub. In a dry run it only
# prints the command. Otherwise it runs it, counts it and logs it to LOG.md with its undo; a failure
# is reported and returns 1 so the caller can decide whether to go on.
change() {
  local name=$1 undo=$2; shift 2
  if ! applying; then run "$@"; return 0; fi
  if run "$@"; then
    CHANGES=$((CHANGES + 1))
    ok "$name: done"
    log_row "$name" "$(quote_cmd "$@")" "done" "$undo"
  else
    fail "$name: failed (the error is above)"
    log_row "$name" "$(quote_cmd "$@")" "FAILED" ""
    return 1
  fi
}

# --- LOG.md in the backup kit ----------------------------------------------------------------------

LOG_HEADER_WRITTEN=0

# log_row "Step" "Command or check" "Result" "Undo" — appends a row to $KIT_LOG when the image is
# mounted. Dry runs write nothing, not even here. The first row of a run adds its own section and
# table header, so the rows read correctly whatever the rest of the file looks like.
log_row() {
  applying || return 0
  [ -w "$KIT_LOG" ] || return 0
  if [ "$LOG_HEADER_WRITTEN" = 0 ]; then
    {
      printf '\n## %s — %s (%s, admin panel repo)\n\n' "$(date '+%Y-%m-%d %H:%M')" "$SCRIPT_NAME" "$MODE"
      printf '| Time | Step | Command / check | Result | Undo |\n'
      printf '|---|---|---|---|---|\n'
    } >>"$KIT_LOG"
    LOG_HEADER_WRITTEN=1
  fi
  # A pipe inside a cell would split it.
  local s c r u
  s=${1//|/\\|}; c=${2//|/\\|}; r=${3//|/\\|}; u=${4//|/\\|}
  # shellcheck disable=SC2016 # the backticks are Markdown, not a command substitution
  printf '| %s | %s | `%s` | %s | %s |\n' "$(date '+%H:%M')" "$s" "$c" "$r" "${u:-—}" >>"$KIT_LOG"
}

kit_mounted() { [ -d "$KIT_MOUNT" ] && [ -w "$KIT_MOUNT" ]; }

# --- Azure helpers ---------------------------------------------------------------------------------

# Every az call names the subscription explicitly, so it cannot land somewhere else after an
# `az login --tenant <CIAM> --allow-no-subscriptions` changed the CLI's default.
azq() { az "$@" --subscription "$SUB_ID" 2>/dev/null; }

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is not installed. $2"; }

preflight() {
  step "Preflight" "Checks the tools, that az is signed in, and that it can see the flight-assistant subscription in the expected tenant. Changes nothing."
  need az "Install it with: brew install azure-cli"
  need curl ""
  ok "az $(az version --query '"azure-cli"' -o tsv 2>/dev/null)"

  # The default account has to be this subscription, not just a visible one: az rest (used for the
  # Easy Auth settings) has no --subscription and signs its requests with the default account.
  local sub
  sub=$(az account show --query "[id, tenantId, name]" -o tsv 2>/dev/null | tr '\t' ' ') || sub=""
  if [ -z "$sub" ]; then
    fail "az is not signed in."
    info "Sign in:  az login --tenant $TENANT_ID"
    info "Then:     az account set --subscription $SUB_ID"
    exit 1
  fi
  # shellcheck disable=SC2086 # split the three tsv fields on purpose
  set -- $sub
  if [ "$1" != "$SUB_ID" ]; then
    fail "az's default subscription is $1 (${*:3}), not flight-assistant."
    info "Switch (changes only your local az config):  az account set --subscription $SUB_ID"
    exit 1
  fi
  [ "$2" = "$TENANT_ID" ] || die "Subscription is in tenant $2, expected $TENANT_ID."
  ok "subscription ${*:3} ($1)"
  ok "signed in as $(az account show --query user.name -o tsv 2>/dev/null)"

  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    HAVE_GH=1
    ok "gh signed in"
  else
    HAVE_GH=0
    warn "gh missing or not signed in (brew install gh; gh auth login). The workflow step will only print what to do."
  fi

  if kit_mounted; then
    ok "backup kit mounted at $KIT_MOUNT"
  else
    info "backup kit not mounted ($KIT_MOUNT). To mount: hdiutil attach \"$KIT_IMAGE\""
  fi
}

plan_sku()   { azq appservice plan show -g "$RG" -n "$PLAN" --query sku.name -o tsv; }
app_state()  { azq webapp show -g "$RG" -n "$1" --query state -o tsv; }
always_on()  { azq webapp config show -g "$RG" -n "$1" --query alwaysOn -o tsv; }

workflow_state() {
  [ "${HAVE_GH:-0}" = 1 ] || { echo "unknown"; return; }
  gh api "repos/$REPO/actions/workflows/$DEPLOY_WORKFLOW_ID" --jq .state 2>/dev/null || echo "unknown"
}

summary() {
  printf '\n%s== Summary ==%s\n' "$C_BOLD" "$C_RESET"
  if applying; then
    info "mode: $MODE, changes made: $CHANGES, warnings: $WARNINGS"
    if [ "$LOG_HEADER_WRITTEN" = 1 ]; then info "logged to $KIT_LOG"; elif ! kit_mounted; then info "not logged: backup kit not mounted"; fi
  else
    info "dry run: nothing was changed. Warnings: $WARNINGS"
    info "run again with --guided (explain + ask per step) or --apply to make the changes."
  fi
}
