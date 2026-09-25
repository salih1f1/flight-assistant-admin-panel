#!/usr/bin/env bash
# Pauses the admin panel without losing its setup: the reverse of scripts/resume-panel.sh.
#
# Exports the panel's settings into the encrypted backup kit, turns Always On off, stops the app and
# disables the Deploy panel workflow. Moves the shared plan to F1 (the step that makes it free) only
# when the API is stopped too; otherwise the plan stays on B1 and keeps billing. Deletes nothing.
#
#   scripts/pause-panel.sh            dry run: shows what it would do, changes nothing
#   scripts/pause-panel.sh --guided   explains each step and asks y/n before each change
#   scripts/pause-panel.sh --apply    makes the changes without asking
#
# Needs the backup kit mounted (hdiutil attach …/fa-pause.sparseimage -> /Volumes/FA-Pause) for
# anything but a dry run. Safe to run again.
set -euo pipefail

SCRIPT_NAME="scripts/pause-panel.sh"
# shellcheck source-path=SCRIPTDIR source=lib/panel-common.sh
. "$(cd "$(dirname "$0")" && pwd)/lib/panel-common.sh"

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
}

parse_mode "$@"
printf '%spause-panel%s — mode: %s\n' "$C_BOLD" "$C_RESET" "$MODE"

preflight

# --- 1. Export -------------------------------------------------------------------------------------

step "Export the panel's settings into the backup kit" \
  "Saves the app, its site config, app settings, IP rules, managed identity and Easy Auth settings (authsettingsV2, which holds the allowlist and the gate's app id) to $KIT_EXPORT. Nothing is lost by stopping the app, but these files are what rebuilds it if it is ever deleted. Reads Azure, writes only to the image."

AUTH_URI="https://management.azure.com/subscriptions/$SUB_ID/resourceGroups/$RG/providers/Microsoft.Web/sites/$APP/config/authsettingsV2?api-version=2022-03-01"

# export_one KIND CMD... — writes $KIT_EXPORT/$APP.KIND.json. An existing file with different
# contents is kept alongside as $APP.KIND.<timestamp>.json rather than overwritten.
export_one() {
  local kind=$1; shift
  local dest="$KIT_EXPORT/$APP.$kind.json" tmp
  if ! applying; then info "would save $(quote_cmd "$@") > $APP.$kind.json"; return 0; fi
  tmp=$(mktemp)
  if ! "$@" >"$tmp" 2>/dev/null; then rm -f "$tmp"; fail "$kind: export failed"; return 1; fi
  if [ -f "$dest" ] && cmp -s "$tmp" "$dest"; then
    rm -f "$tmp"; ok "$kind: unchanged"
  else
    if [ -f "$dest" ]; then mv "$dest" "$KIT_EXPORT/$APP.$kind.$(date +%Y%m%d-%H%M%S).json"; fi
    mv "$tmp" "$dest"; ok "$kind: saved"; EXPORT_SAVED=$((EXPORT_SAVED + 1))
  fi
}

if applying && ! kit_mounted; then
  die "The backup kit is not mounted, so there is nowhere to export to. Mount it and re-run: hdiutil attach \"$KIT_IMAGE\""
fi
# App settings can hold secrets; keep the files readable only by you, even inside the image.
umask 077
applying && mkdir -p "$KIT_EXPORT"
EXPORT_OK=1
EXPORT_SAVED=0
export_one show        az webapp show -g "$RG" -n "$APP" --subscription "$SUB_ID"                              || EXPORT_OK=0
export_one config      az webapp config show -g "$RG" -n "$APP" --subscription "$SUB_ID"                       || EXPORT_OK=0
export_one appsettings az webapp config appsettings list -g "$RG" -n "$APP" --subscription "$SUB_ID"           || EXPORT_OK=0
export_one access      az webapp config access-restriction show -g "$RG" -n "$APP" --subscription "$SUB_ID"   || EXPORT_OK=0
export_one identity    az webapp identity show -g "$RG" -n "$APP" --subscription "$SUB_ID"                     || EXPORT_OK=0
export_one authv2      az rest --method GET --uri "$AUTH_URI"                                                  || EXPORT_OK=0
if applying; then
  [ "$EXPORT_OK" = 1 ] || die "Not every export succeeded, so nothing was stopped. Fix the error and re-run."
  log_row "Export panel settings" "az webapp show/config/appsettings/access-restriction/identity, authsettingsV2" \
    "$EXPORT_SAVED of 6 saved to 01-azure-export/$APP.*.json, the rest unchanged" ""
fi

# --- 2. Always On ----------------------------------------------------------------------------------

step "Panel: Always On off" \
  "F1 does not allow Always On on any app in the plan, so it has to be off before the plan can move to F1. Affects only the panel."

AO=$(always_on "$APP") || AO=""
if [ "$AO" = "false" ]; then
  ok "Always On is already off"
elif confirm "Turn Always On off for $APP?"; then
  change "Panel Always On off" "az webapp config set -g $RG -n $APP --always-on true (needs B1)" \
    az webapp config set -g "$RG" -n "$APP" --always-on false --subscription "$SUB_ID" -o none || true
fi

# --- 3. Stop ---------------------------------------------------------------------------------------

step "Panel: stop the web app" \
  "Stops $APP. Its IP allowlist, Easy Auth, app settings and the last deployed package all stay. On its own this saves nothing: App Service bills the plan, not the app."

STATE=$(app_state "$APP") || STATE=""
[ -n "$STATE" ] || die "Cannot read $APP in $RG."
if [ "$STATE" = "Stopped" ]; then
  ok "already stopped"
elif confirm "Stop $APP (currently $STATE)?"; then
  change "Panel stop (was $STATE)" "az webapp start -g $RG -n $APP" \
    az webapp stop -g "$RG" -n "$APP" --subscription "$SUB_ID" -o none || true
fi

# --- 4. Deploy workflow ----------------------------------------------------------------------------

step "GitHub: disable the Deploy panel workflow" \
  "So a push to main does not deploy to a stopped app. CI stays enabled; it does not touch Azure."

WF=$(workflow_state)
if [ "$WF" = "disabled_manually" ]; then
  ok "already disabled"
elif [ "${HAVE_GH:-0}" != 1 ]; then
  warn "cannot check or disable it without gh. By hand: GitHub -> Actions -> Deploy panel -> ... -> Disable workflow"
elif confirm "Disable workflow $DEPLOY_WORKFLOW_ID (currently $WF)?"; then
  change "Disable Deploy panel workflow (was $WF)" "gh workflow enable $DEPLOY_WORKFLOW_ID -R $REPO" \
    gh workflow disable "$DEPLOY_WORKFLOW_ID" -R "$REPO" || true
fi

# --- 5. The plan -----------------------------------------------------------------------------------

step "App Service plan: B1 -> F1, only if the API is stopped too" \
  "The plan is shared with $API_APP, and F1 is what brings its bill to \$0. This script only pauses the panel, so it moves the plan only when the API is already stopped with Always On off, and never touches the API itself. The plan is never deleted."

SKU=$(plan_sku) || SKU=""
[ -n "$SKU" ] || die "Cannot read plan $PLAN in $RG."
API_STATE=$(app_state "$API_APP") || API_STATE=""
API_AO=$(always_on "$API_APP") || API_AO=""
PANEL_AO=$(always_on "$APP") || PANEL_AO=""
info "plan is on $SKU; the API is ${API_STATE:-unknown} with Always On ${API_AO:-unknown}"

if [ "$SKU" = "F1" ]; then
  ok "already on F1"
elif [ "$API_STATE" != "Stopped" ]; then
  info "the API is ${API_STATE:-unknown}, so the plan stays on $SKU and keeps billing (roughly \$13 a month)."
  info "to reach \$0, pause the API from the backend repo, then run this again."
elif [ "$API_AO" != "false" ]; then
  warn "the API is stopped but its Always On is ${API_AO:-unknown}, which F1 refuses. From the backend side:"
  info "  az webapp config set -g $RG -n $API_APP --always-on false --subscription $SUB_ID"
elif applying && [ "$PANEL_AO" != "false" ]; then
  warn "the panel's Always On is still on (step 2 was skipped or failed), which F1 refuses. Plan left on $SKU."
elif confirm "Scale $PLAN (shared with the stopped API) from $SKU to F1?"; then
  change "Plan $SKU -> F1" "az appservice plan update -g $RG -n $PLAN --sku B1" \
    az appservice plan update -g "$RG" -n "$PLAN" --sku F1 --subscription "$SUB_ID" -o none || true
fi

summary
if applying; then info "to bring it back: scripts/resume-panel.sh --guided"; fi
