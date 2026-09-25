#!/usr/bin/env bash
# Brings the admin panel back after scripts/pause-panel.sh (or the full pause of 2026-09-26).
#
# Panel only. To restore everything — plan, database, API, panel and both deploy workflows — run the
# backend's scripts/resume-azure.sh instead; this script is for when only the panel is wanted, or
# to re-check the panel after the full restore.
#
#   scripts/resume-panel.sh            dry run: shows what it would do, changes nothing
#   scripts/resume-panel.sh --guided   explains each step and asks y/n before each change
#   scripts/resume-panel.sh --apply    makes the changes without asking
#
# Safe to run again: each step looks at the current state first and skips what is already done.
set -euo pipefail

SCRIPT_NAME="scripts/resume-panel.sh"
# shellcheck source-path=SCRIPTDIR source=lib/panel-common.sh
. "$(cd "$(dirname "$0")" && pwd)/lib/panel-common.sh"

usage() {
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
}

parse_mode "$@"
printf '%sresume-panel%s — mode: %s\n' "$C_BOLD" "$C_RESET" "$MODE"

preflight

# Set when this run changed something that makes the app restart, so the HTTP check waits for it.
RESTARTED=0

# --- 1. The plan -----------------------------------------------------------------------------------

step "App Service plan: F1 -> B1" \
  "The panel and the API share $PLAN. Moving it to B1 is what starts the bill again (roughly \$13 a month) — for the plan, so it covers both apps whether or not the API is running. B1 is also needed for Always On, which F1 does not support."

SKU=$(plan_sku) || SKU=""
[ -n "$SKU" ] || die "Cannot read plan $PLAN in $RG."
API_STATE=$(app_state "$API_APP") || API_STATE="unknown"
info "plan $PLAN is on $SKU; the API ($API_APP) is ${API_STATE:-unknown}"

if [ "$SKU" = "F1" ]; then
  if confirm "Scale $PLAN (shared with the API, which is $API_STATE) from F1 to B1?"; then
    change "Plan F1 -> B1 (API was $API_STATE)" \
      "az appservice plan update -g $RG -n $PLAN --sku F1 (only with Always On off on both apps)" \
      az appservice plan update -g "$RG" -n "$PLAN" --sku B1 --subscription "$SUB_ID" -o none \
      || die "Scaling the plan failed. Nothing after this step was attempted."
    if applying; then SKU="B1"; RESTARTED=1; fi
  fi
else
  ok "already on $SKU, nothing to do"
fi

# --- 2. Always On ----------------------------------------------------------------------------------

step "Panel: Always On" \
  "Keeps the panel's container warm so the first request after a quiet spell does not wait for a cold start. Affects only the panel. Not available on F1."

AO=$(always_on "$APP") || AO=""
if [ "$AO" = "true" ]; then
  ok "Always On is already on"
elif [ "$SKU" = "F1" ]; then
  if applying; then warn "plan is still on F1, so Always On cannot be set. Skipped."
  else info "would turn Always On on once the plan is on B1 (step 1)"; fi
elif confirm "Turn Always On on for $APP?"; then
  if change "Panel Always On" "az webapp config set -g $RG -n $APP --always-on false" \
      az webapp config set -g "$RG" -n "$APP" --always-on true --subscription "$SUB_ID" -o none; then
    applying && RESTARTED=1
  fi
fi

# --- 3. Start --------------------------------------------------------------------------------------

step "Panel: start the web app" \
  "Starts $APP. It serves the package from the last successful deploy; its IP allowlist, Easy Auth and app settings were kept while it was stopped."

STATE=$(app_state "$APP") || STATE=""
[ -n "$STATE" ] || die "Cannot read $APP in $RG. If the app was deleted, see docs/PAUSE-AND-RESUME-AZURE.md."
if [ "$STATE" = "Running" ]; then
  ok "already running"
elif confirm "Start $APP (currently $STATE)?"; then
  if change "Panel start (was $STATE)" "az webapp stop -g $RG -n $APP" \
      az webapp start -g "$RG" -n "$APP" --subscription "$SUB_ID" -o none; then
    applying && RESTARTED=1
  fi
fi

# --- 4. Deploy workflow ----------------------------------------------------------------------------

step "GitHub: enable the Deploy panel workflow" \
  "While paused, the workflow ($DEPLOY_WORKFLOW_ID) was disabled so pushes to main did not deploy to a stopped app. Enabling it deploys nothing by itself; the next push to main does. CI is separate and was never disabled."

WF=$(workflow_state)
if [ "$WF" = "active" ]; then
  ok "already enabled"
elif [ "${HAVE_GH:-0}" != 1 ]; then
  warn "cannot check or enable it without gh. By hand: GitHub -> Actions -> Deploy panel -> Enable workflow"
elif confirm "Enable workflow $DEPLOY_WORKFLOW_ID (currently $WF)?"; then
  change "Enable Deploy panel workflow (was $WF)" "gh workflow disable $DEPLOY_WORKFLOW_ID -R $REPO" \
    gh workflow enable "$DEPLOY_WORKFLOW_ID" -R "$REPO" || true
fi
info "to redeploy main now, without a push: gh workflow run deploy.yml -R $REPO --ref main"

# --- 5. Easy Auth and the gate's client secret -----------------------------------------------------

step "Check: Easy Auth and the gate's client secret" \
  "Easy Auth signs you in through the gate's app registration, which lives in the CIAM tenant (flightassistantextid), not the subscription's tenant. An expired client secret makes sign-in fail after the tenant step, with an error that looks like an allowlist problem. Read-only."

AUTH_URI="https://management.azure.com/subscriptions/$SUB_ID/resourceGroups/$RG/providers/Microsoft.Web/sites/$APP/config/authsettingsV2?api-version=2022-03-01"
AAD="properties.identityProviders.azureActiveDirectory"
auth_q() { az rest --method GET --uri "$AUTH_URI" --query "$1" -o tsv 2>/dev/null; }

AUTH_ON=$(auth_q "properties.platform.enabled") || AUTH_ON=""
UNAUTH=$(auth_q "properties.globalValidation.unauthenticatedClientAction") || UNAUTH=""
GATE_APP=$(auth_q "$AAD.registration.clientId") || GATE_APP=""
ISSUER=$(auth_q "$AAD.registration.openIdIssuer") || ISSUER=""
SECRET_SETTING=$(auth_q "$AAD.registration.clientSecretSettingName") || SECRET_SETTING=""
ALLOWED=$(auth_q "length($AAD.validation.defaultAuthorizationPolicy.allowedPrincipals.identities || \`[]\`)") || ALLOWED=""

if [ "$AUTH_ON" = "true" ]; then ok "Easy Auth enabled, unauthenticated requests: ${UNAUTH:-?}"
else warn "Easy Auth is not enabled (platform.enabled=${AUTH_ON:-unreadable}). The panel would be open to anyone the IP rules let through."; fi
if [ -n "$ALLOWED" ] && [ "$ALLOWED" -gt 0 ] 2>/dev/null; then ok "allowedPrincipals.identities lists $ALLOWED account(s)"
else warn "allowedPrincipals.identities is empty or unreadable — any account in the tenant, travelers included, would pass the gate"; fi

CIAM_TENANT=$(printf '%s' "$ISSUER" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -n 1 || true)
if [ -z "$GATE_APP" ] || [ -z "$CIAM_TENANT" ]; then
  warn "could not read the gate's app id or tenant from the auth settings; check the secret by hand: Entra (flightassistantextid) -> App registrations -> the gate -> Certificates & secrets"
else
  info "gate app registration $GATE_APP in tenant $CIAM_TENANT; secret app setting: ${SECRET_SETTING:-?}"
  # A Graph token for the other tenant, from az's cache. Does not change the default account.
  GRAPH_TOKEN=$(az account get-access-token --tenant "$CIAM_TENANT" --resource-type ms-graph --query accessToken -o tsv 2>/dev/null || true)
  if [ -z "$GRAPH_TOKEN" ]; then
    warn "no token for the CIAM tenant. To let this check run, sign in to it once (then re-run):"
    info "  az login --tenant $CIAM_TENANT --allow-no-subscriptions && az account set --subscription $SUB_ID"
  else
    CREDS=$(az rest --method GET \
      --uri "https://graph.microsoft.com/v1.0/applications(appId='$GATE_APP')?\$select=passwordCredentials" \
      --headers "Authorization=Bearer $GRAPH_TOKEN" \
      --query "passwordCredentials[].[endDateTime, hint, displayName]" -o tsv 2>/dev/null || true)
    unset GRAPH_TOKEN
    if [ -z "$CREDS" ]; then
      warn "the gate has no client secrets, or Graph refused to list them"
    else
      NOW=$(date -u +%s); BEST_DAYS=""
      while IFS=$'\t' read -r END HINT NAME; do
        [ -n "$END" ] || continue
        T=${END%%.*}; T=${T%Z}
        EPOCH=$(date -u -d "$T" +%s 2>/dev/null || date -u -j -f '%Y-%m-%dT%H:%M:%S' "$T" +%s 2>/dev/null || echo "")
        if [ -z "$EPOCH" ]; then info "secret ${HINT}… (${NAME:-no name}) expires $END"; continue; fi
        DAYS=$(( (EPOCH - NOW) / 86400 ))
        info "secret ${HINT}… (${NAME:-no name}) expires ${END%%T*}: $DAYS days"
        if [ -z "$BEST_DAYS" ] || [ "$DAYS" -gt "$BEST_DAYS" ]; then BEST_DAYS=$DAYS; fi
      done <<<"$CREDS"
      if [ -z "$BEST_DAYS" ]; then warn "could not work out the expiry dates"
      elif [ "$BEST_DAYS" -lt 0 ]; then warn "every client secret has expired. Create one, then put it in the Key Vault secret that $SECRET_SETTING refers to"
      elif [ "$BEST_DAYS" -lt 30 ]; then warn "the newest client secret expires in $BEST_DAYS days (< 30). Rotate it: new secret -> Key Vault secret behind $SECRET_SETTING"
      else ok "newest client secret has $BEST_DAYS days left"; fi
      log_row "Check gate secret" "Graph: applications(appId=$GATE_APP).passwordCredentials" "newest: ${BEST_DAYS:-?} days left" ""
    fi
  fi
fi

# --- 6. Your IP vs the access restrictions ---------------------------------------------------------

step "Check: your public IP vs the panel's access restrictions" \
  "The panel refuses every IP not on its allowlist with a flat 403, before any sign-in. Home ISPs rotate addresses, so this compares your current one with the rules. Read-only; adding a rule is offered, never done silently."

ip_to_int() {
  local IFS=.
  # shellcheck disable=SC2086 # split the dotted quad on purpose
  set -- $1
  echo $(( ($1 << 24) + ($2 << 16) + ($3 << 8) + $4 ))
}
is_ipv4() { printf '%s' "$1" | grep -qE '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; }

MY_IP=$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)
if ! is_ipv4 "$MY_IP"; then
  warn "could not find your public IPv4 address (api.ipify.org)"
else
  info "your public IP: $MY_IP"
  MY_INT=$(ip_to_int "$MY_IP")
  DEFAULT_ACTION=$(azq webapp config access-restriction show -g "$RG" -n "$APP" --query ipSecurityRestrictionsDefaultAction -o tsv || true)
  SCM_USES_MAIN=$(azq webapp config access-restriction show -g "$RG" -n "$APP" --query scmIpSecurityRestrictionsUseMain -o tsv || true)
  RULES=$(azq webapp config access-restriction show -g "$RG" -n "$APP" \
    --query "ipSecurityRestrictions[].[priority, action, ipAddress, name]" -o tsv || true)

  # The matching rule with the lowest priority number wins, as in App Service itself.
  BEST_PRIO=""; BEST_ACTION=""; BEST_NAME=""
  while IFS=$'\t' read -r PRIO ACTION ADDR NAME; do
    [ -n "$ADDR" ] || continue
    if [ "$ADDR" = "Any" ]; then MATCH=1
    else
      NET=${ADDR%/*}; BITS=${ADDR#*/}; [ "$BITS" = "$ADDR" ] && BITS=32
      is_ipv4 "$NET" || continue
      MASK=$(( BITS == 0 ? 0 : (0xFFFFFFFF << (32 - BITS)) & 0xFFFFFFFF ))
      NET_INT=$(ip_to_int "$NET")
      MATCH=0; [ $(( MY_INT & MASK )) -eq $(( NET_INT & MASK )) ] && MATCH=1
    fi
    if [ "$MATCH" = 1 ] && { [ -z "$BEST_PRIO" ] || [ "$PRIO" -lt "$BEST_PRIO" ]; }; then
      BEST_PRIO=$PRIO; BEST_ACTION=$ACTION; BEST_NAME=$NAME
    fi
  done <<<"$RULES"

  if [ "$BEST_ACTION" = "Allow" ]; then
    ok "allowed by rule '$BEST_NAME' (priority $BEST_PRIO)"
  else
    if [ -n "$BEST_ACTION" ]; then warn "your IP is denied by rule '$BEST_NAME' (priority $BEST_PRIO)"
    else warn "no rule matches your IP; default action is ${DEFAULT_ACTION:-?}, so the panel answers 403"; fi
    RULE_NAME="$(whoami)-$(date +%Y%m%d)"
    ADD_CMD=(az webapp config access-restriction add -g "$RG" -n "$APP" --rule-name "$RULE_NAME"
      --action Allow --priority 100 --ip-address "$MY_IP/32" --subscription "$SUB_ID" -o none)
    info "to allow it: $(quote_cmd "${ADD_CMD[@]}")"
    if [ "$MODE" = "guided" ] && confirm "Add an Allow rule for $MY_IP/32 to the panel?"; then
      change "Allow my IP $MY_IP/32 (rule $RULE_NAME)" \
        "az webapp config access-restriction remove -g $RG -n $APP --rule-name $RULE_NAME" \
        "${ADD_CMD[@]}" || true
    fi
  fi
  if [ "$SCM_USES_MAIN" = "true" ]; then
    warn "the SCM (deploy) site inherits the main site's IP rules; GitHub runners will be refused. Turn scmIpSecurityRestrictionsUseMain off"
  fi
fi

# --- 7. HTTP -------------------------------------------------------------------------------------

step "Check: the panel answers" \
  "Requests $PANEL_URL/ without signing in. Expected: a 302 to the Easy Auth sign-in. 403 means the IP allowlist (or the app is stopped); 503 or a timeout right after a start or plan change is the container warming up. Read-only."

TMP_BODY=$(mktemp)
trap 'rm -f "$TMP_BODY"' EXIT
ATTEMPTS=1
if applying && [ "$RESTARTED" = 1 ]; then ATTEMPTS=8; fi

n=1
while :; do
  RESULT=$(curl -sS -o "$TMP_BODY" -w '%{http_code} %{redirect_url}' --max-time 60 "$PANEL_URL/" 2>/dev/null || echo "000")
  CODE=${RESULT%% *}; LOCATION=${RESULT#* }; [ "$LOCATION" = "$RESULT" ] && LOCATION=""
  case "$CODE" in
    301|302|303|307)
      case "$LOCATION" in
        */.auth/login*|*login.microsoftonline.com*|*ciamlogin.com*)
          ok "$CODE -> Easy Auth sign-in (${LOCATION%%\?*})"; HTTP_RESULT="ok ($CODE to sign-in)" ;;
        *) warn "$CODE redirect to an unexpected place: $LOCATION"; HTTP_RESULT="$CODE to $LOCATION" ;;
      esac
      break ;;
    401) ok "401 — Easy Auth is refusing anonymous requests (set to return 401 rather than redirect)"; HTTP_RESULT="ok (401)"; break ;;
    200) warn "200 without signing in — Easy Auth is not gating the panel. Check Authentication in the portal"; HTTP_RESULT="200 unauthenticated"; break ;;
    403)
      # "This web app is stopped" is worth waiting out right after a start; an IP refusal is not.
      if grep -qi "stopped" "$TMP_BODY"; then
        if [ "$n" -lt "$ATTEMPTS" ]; then :; else warn "403: the web app is stopped"; HTTP_RESULT="403 stopped"; break; fi
      else
        warn "403: your IP is not on the allowlist (step 6)"; HTTP_RESULT="403 IP not allowed"; break
      fi ;;
    *)
      if [ "$n" -ge "$ATTEMPTS" ]; then
        if [ "$CODE" = "000" ]; then warn "no answer (timeout or connection error)"; else warn "HTTP $CODE"; fi
        [ "$ATTEMPTS" -gt 1 ] && info "it may still be warming up; re-run this script in a minute or two"
        HTTP_RESULT="HTTP $CODE"
        break
      fi ;;
  esac
  info "HTTP $CODE, waiting for the app to warm up ($n/$ATTEMPTS)..."
  n=$((n + 1))
  sleep 20
done
log_row "Check panel URL" "curl $PANEL_URL/" "${HTTP_RESULT:-?}" ""

if [ "$MODE" = "dry-run" ] && [ "$STATE" != "Running" ]; then
  info "(the app is still stopped, so a 403 here is expected in a dry run)"
fi

summary
