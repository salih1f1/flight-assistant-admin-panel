# Deploying the panel to a new environment

The runbook for standing up the admin panel in stage or production, derived from doing it for dev
on 2026-09-19. Follow it in order: several steps only work because an earlier one ran, and two of
them fail in ways that look like a completely different problem.

The design reasoning lives in `docs/superpowers/specs/2026-09-19-panel-azure-deploy-design.md`.
This file is the mechanics.

## Before you start

**The API must exist in the target environment first.** The panel is useless without it, and one
step here edits the API's CORS list.

**Decide whether the environment shares an App Service plan.** Dev puts the panel on the same B1
plan as the dev API, which is why it costs nothing. For production, give it its own plan: the panel
and the API would otherwise compete for one B1 worker, and a plan busy serving the API is a poor
place to put the tool you use when the API is misbehaving.

**Use a separate app registration per environment — never reuse dev's.** That applies to both
registrations below. Sharing one means a stage sign-in issues tokens accepted by production.

Set these once and the rest of the runbook is copy-paste:

```sh
ENV=stage                                   # stage | prod
RG=flight-assistant-$ENV
PLAN=<the plan to host it on>
APP=flight-assistant-$ENV-panel
VAULT=flightassistant${ENV}-kv
SUBSCRIPTION=<subscription id>
CIAM_TENANT=<the environment's External ID tenant id>
API_HOST=<the API's real default hostname — check it, see step 2>
```

## 1. Create the web app

```sh
az webapp create -g $RG -p $PLAN -n $APP --runtime "NODE:22-lts"
az webapp update -g $RG -n $APP --https-only true
az webapp config set -g $RG -n $APP --startup-file "node server.js"
az webapp config appsettings set -g $RG -n $APP --settings \
  SCM_DO_BUILD_DURING_DEPLOYMENT=false WEBSITE_NODE_DEFAULT_VERSION=~22
```

`SCM_DO_BUILD_DURING_DEPLOYMENT=false` because the package is already built and has no dependencies
to install.

**Verify:** the app is on the intended plan and no new plan was created.

```sh
az appservice plan list -g $RG -o table
az webapp list -g $RG --query "[].{name:name, plan:appServicePlanId}" -o table
```

## 2. Read the real hostname — do not assume it

```sh
az webapp show -g $RG -n $APP --query defaultHostName -o tsv
az webapp show -g $RG -n <the API app> --query defaultHostName -o tsv
```

Azure sometimes appends a random suffix to default hostnames, and it does so inconsistently: in the
dev environment the panel got the clean `flight-assistant-dev-panel.azurewebsites.net` while the
API got `flight-assistant-dev-api-gfbpekbthnhjcpc4.westeurope-01.azurewebsites.net`. Every
subsequent step uses these two values, so take them from the output rather than from a pattern.

## 3. Deploy identity and repository configuration

In the **subscription's** tenant:

```sh
APP_ID=$(az ad app create --display-name "flight-assistant-panel-deploy-$ENV" --query appId -o tsv)
az ad sp create --id "$APP_ID"

az ad app federated-credential create --id "$APP_ID" --parameters "{
  \"name\": \"panel-$ENV\",
  \"issuer\": \"https://token.actions.githubusercontent.com\",
  \"subject\": \"repo:salih1f1/flight-assistant-admin-panel:ref:refs/heads/main\",
  \"audiences\": [\"api://AzureADTokenExchange\"]
}"

az role assignment create --assignee "$APP_ID" --role "Website Contributor" \
  --scope "/subscriptions/$SUBSCRIPTION/resourceGroups/$RG/providers/Microsoft.Web/sites/$APP"
```

Scope the role to the one app, not the resource group: this credential only ever deploys the panel.

The `subject` must match how the workflow is triggered. `ref:refs/heads/main` covers pushes to main.
If stage and production deploy from the same branch, distinguish them with a GitHub **environment**
and a subject of `repo:<org>/<repo>:environment:<name>` instead, so a production deploy cannot be
triggered by a workflow aimed at stage.

Then the repository variables and secrets. `VITE_*` are variables, not secrets — they are public
identifiers baked into the bundle anyway — and the workflow fails the build if any is empty.

## 4. Register the panel's redirect URI

On the environment's **SPA** app registration (the one the browser uses for API tokens), add
`https://<panel host>` as a redirect URI of type SPA.

This lives in the CIAM tenant, which has **no subscription**, so:

```sh
az login --tenant $CIAM_TENANT --allow-no-subscriptions
az account show --query tenantId -o tsv     # must print $CIAM_TENANT before you continue
```

Without `--allow-no-subscriptions` the CLI silently falls back to the subscription's tenant, and
Graph then reports the app as `Request_ResourceNotFound` — an app that exists perfectly well in the
directory you meant. Check the tenant before every Graph call in this runbook.

A Graph PATCH replaces the whole `spa` object, so list every redirect URI you want to keep:

```sh
az rest --method PATCH \
  --uri "https://graph.microsoft.com/v1.0/applications(appId='<spa app id>')" \
  --headers "Content-Type=application/json" \
  --body '{"spa":{"redirectUris":["http://localhost:5175","https://<panel host>"]}}'
```

**Verify** without clicking anything: request the authorize endpoint with that redirect URI and
confirm you get a sign-in page rather than `AADSTS50011`.

## 5. First deploy, before any locks

Run the workflow and confirm the site serves: root `200`, a deep link falling back to `index.html`,
a hashed asset with `immutable` caching, and the bundle carrying the right authority and API URL.

Deploying before locking is deliberate. If you lock first and the site is broken, you cannot tell
which of the two is at fault.

## 6. The gate: app registration

In the **CIAM** tenant (`--allow-no-subscriptions`, and check the tenant):

```sh
GATE_APP_ID=$(az ad app create --display-name "flight-assistant-panel-gate-$ENV" \
  --web-redirect-uris "https://<panel host>/.auth/login/aad/callback" --query appId -o tsv)
az ad sp create --id "$GATE_APP_ID"
GATE_SECRET=$(az ad app credential reset --id "$GATE_APP_ID" --append \
  --display-name easyauth --query password -o tsv)
```

Keep the secret in a shell variable — never echo it.

**Then enable ID token issuance. Do not skip this.** Easy Auth uses the hybrid flow
(`response_type=code+id_token`) and `az ad app create` leaves the flag off; the portal only sets it
when it creates the registration itself. Without it, sign-in succeeds at the tenant and the callback
returns a bare `401` that is indistinguishable from a bad client secret or a rejected identity. It
was the single most expensive mistake in the dev rollout.

```sh
az rest --method PATCH \
  --uri "https://graph.microsoft.com/v1.0/applications(appId='$GATE_APP_ID')" \
  --headers "Content-Type=application/json" \
  --body "{\"web\":{\"redirectUris\":[\"https://<panel host>/.auth/login/aad/callback\"],\"implicitGrantSettings\":{\"enableIdTokenIssuance\":true}}}"
```

Again: the PATCH replaces the whole `web` object, so the redirect URI is repeated in it.

## 7. The gate: secret and identity

Back in the subscription's tenant (`az account set --subscription $SUBSCRIPTION`, and check):

```sh
az keyvault secret set --vault-name $VAULT --name panel-gate-client-secret \
  --value "$GATE_SECRET" --output none
unset GATE_SECRET

PANEL_PRINCIPAL=$(az webapp identity assign -g $RG -n $APP --query principalId -o tsv)
```

Grant vault access according to the vault's own model — check it rather than assuming:

```sh
az keyvault show --name $VAULT --query properties.enableRbacAuthorization
```

`true` (as in dev) means a role assignment; `false` means an access policy:

```sh
# RBAC vault
az role assignment create --assignee "$PANEL_PRINCIPAL" --role "Key Vault Secrets User" \
  --scope "/subscriptions/$SUBSCRIPTION/resourceGroups/$RG/providers/Microsoft.KeyVault/vaults/$VAULT"

# Access-policy vault
az keyvault set-policy --name $VAULT --secret-permissions get list --object-id "$PANEL_PRINCIPAL"
```

Then the app setting, which holds a reference rather than a value:

```sh
az webapp config appsettings set -g $RG -n $APP --settings \
  GATE_CLIENT_SECRET="@Microsoft.KeyVault(SecretUri=https://$VAULT.vault.azure.net/secrets/panel-gate-client-secret/)" \
  --output none
```

**Verify the reference resolved** — an unresolved one is treated as the literal
`@Microsoft.KeyVault(...)` string and surfaces much later as an opaque sign-in failure:

```sh
az rest --method GET --uri \
  "/subscriptions/$SUBSCRIPTION/resourceGroups/$RG/providers/Microsoft.Web/sites/$APP/config/configreferences/appsettings?api-version=2022-03-01" \
  --query "value[].{name:name, status:properties.status}" -o table
```

Expect `Resolved`. RBAC assignments take a minute to propagate; re-check before investigating.

## 8. The gate: turn it on

PUT the full `authsettingsV2` document — the whole document, so you know exactly what is set:
`platform.enabled`, `globalValidation.requireAuthentication` with `RedirectToLoginPage`, the AAD
provider pointed at `https://<ciam tenant>.ciamlogin.com/<ciam tenant>/v2.0`, `allowedAudiences` of
the gate app id, and `allowedPrincipals.identities` listing every admin's object ID **in that
tenant**.

Get the object IDs from the directory itself — admin accounts created by email sign-up have a GUID
as their UPN, and the email lives in `mail`/`otherMails`:

```sh
az rest --method GET \
  --uri "https://graph.microsoft.com/v1.0/users?\$select=id,displayName,userPrincipalName,mail,otherMails&\$top=40" \
  --query "value[].{objectId:id, name:displayName, mail:mail}" -o table
```

**Every auth configuration change restarts the auth container, and warm-up takes 60 seconds or
more.** A timeout straight after a change is the restart. Wait before concluding anything.

**Verify** anonymous access is refused: `curl` gets `401`, a browser gets `302` to the tenant, and
`/assets/*` is gated too. If `/.auth/me` returns your own HTML, Easy Auth is not in front of the app
yet — the sidecar is injected on restart.

## 9. Prove the gate excludes, not just that it admits

**This step is not optional.** Signing in successfully proves only that *you* are allowed. It says
nothing about anyone being kept out, and the directory holds traveler accounts.

Point `allowedPrincipals.identities` at a GUID belonging to nobody, wait for the restart, then sign
in from a fresh session (`/.auth/logout` first).

Expected: sign-in succeeds and the app answers **403 — "You don't have authorization to view this
page."** Authentication passed, authorization did not.

If the panel loads instead, the allowlist is decorative in that environment: stop, restore, and
treat the network layer as the only identity-independent lock. Do not carry on and call it locked.

Restore the real identities afterwards and confirm you can get back in.

## 10. Network restrictions

Add the allow rules **before** changing the default action, or you lock yourself out between the
two commands:

```sh
az webapp config access-restriction add -g $RG -n $APP \
  --rule-name admin-primary --action Allow --priority 100 \
  --ip-address "$(curl -s https://api.ipify.org)/32"

az webapp config access-restriction show -g $RG -n $APP \
  --query "ipSecurityRestrictions[].{name:name,action:action,ip:ipAddress}" -o table

az webapp config access-restriction set -g $RG -n $APP --default-action Deny
```

**Never restrict the SCM site.** Deployments reach Kudu from GitHub runners whose IPs change every
run, so mirroring the main site's rules there breaks every deploy after the first:

```sh
az webapp config access-restriction show -g $RG -n $APP \
  --query "scmIpSecurityRestrictionsUseMain"    # must be false
```

**Verify from an IP that is not allowlisted** — Azure Cloud Shell or a phone off wifi. Expect `403`
with no sign-in redirect, because the request dies before Easy Auth sees it. A machine on your own
network cannot perform this check, however convenient it is.

Then **redeploy**. That is what catches an SCM restriction applied by accident.

## 11. CORS on the API

Add the panel's origin to `AdminPanel:AllowedOrigins` for that environment. It is a list: add,
never replace, or you break whichever environment held the previous value.

For dev the value lives in `appsettings.Development.json`, which ships to the deployed dev API
because it runs as `Development`. For stage and production, prefer an App Service app setting
(`AdminPanel__AllowedOrigins__0`) so the origin is not baked into a committed file.

Deploy the API before closing the panel's network restrictions, or you lock the panel down around
an API it cannot call.

## 12. Content-Security-Policy

Set `CONTENT_SECURITY_POLICY` as an app setting, with `connect-src` covering the API and the
authority, and `frame-src` covering the authority.

`frame-src` is load-bearing: MSAL renews tokens in a hidden iframe against the authority, so a
policy without it produces an app that works until a token expires and then fails in a way that
looks nothing like a CSP problem. `style-src` needs `'unsafe-inline'` for the UI components.

The server omits the header entirely when the setting is absent, so clearing it is the recovery
path. Verify in a signed-in browser with the console open — the header only appears on
authenticated responses, so it cannot be checked from outside the gate.

## Afterwards

- **Record the client secret's expiry.** The default is two years and nothing warns you. When it
  lapses the symptom is a sudden callback `401` — identical to the ID-token-issuance bug above.
- **Note the allowlisted IPs somewhere.** A rotated ISP address presents as a flat `403` with no
  sign-in page.
- **Write down what you did not verify.** The dev rollout finished with two unverified claims, and
  saying so plainly was more useful than a clean-looking checklist.

## The shape of the failures, in one place

| Symptom | Cause |
|---|---|
| `AADSTS50011` at sign-in | redirect URI not on the SPA registration |
| Bare `401` from `/.auth/login/aad/callback` | ID token issuance not enabled on the gate registration |
| `Request_ResourceNotFound` for an app that exists | `az` fell back to the wrong tenant; use `--allow-no-subscriptions` |
| Site serves `200` with auth configured | auth container not injected yet; restart and wait |
| `ERR_TIMED_OUT` right after an auth change | the restart; 60s+ warm-up on B1 |
| Sign-in works, then `403` | the account is not in `allowedPrincipals.identities` — the gate working |
| Flat `403`, no sign-in page | the IP is not allowlisted |
| Deploy fails at Kudu | the SCM site inherited the main site's IP rules |
| Grid loads empty, console CORS error | the panel's origin is not in `AdminPanel:AllowedOrigins` |
