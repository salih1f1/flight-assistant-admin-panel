# Pausing the dev environment in Azure, and bringing it back

## Current state: paused since 2026-09-26

The whole dev environment (API, panel, database) was paused on 2026-09-26 to stop the bill. Nothing
the panel needs was deleted:

| Thing | Name | State |
|---|---|---|
| Subscription | `flight-assistant` (`a39b9c33-675b-40ca-84fc-6e548ef6d6c5`), tenant `967285b3-fe6f-48ae-b2b9-d9b136222022` | unchanged (renamed earlier) |
| Resource group | `flight-assistant-dev`, West Europe | unchanged |
| App Service plan | `ASP-flightassistantdev-88a9`, shared by the API and the panel | moved **B1 → F1**, **not deleted** |
| Panel | `flight-assistant-dev-panel` | **stopped**, Always On off, **not deleted**. IP allowlist, Easy Auth (`allowedPrincipals`) and all app settings intact |
| API | `flight-assistant-dev-api` | paused on the backend side; see the backend repo |
| *Deploy panel* workflow (id `362302398`) | `.github/workflows/deploy.yml` | **disabled** |
| *CI* workflow (id `361724743`) | `.github/workflows/ci.yml` | active; it never touches Azure |

Every step of the pause, with its undo, is in `LOG.md` in the backup kit (below).

> Earlier versions of this file described a manual pause with exports under `~/fa-pause`, and
> offered deleting the plan. Both are superseded: the exports live in the encrypted image, and the
> plan was moved to F1, not deleted.

## Bringing it back

| You want | Run |
|---|---|
| **Everything back** — plan, database, API, panel, both deploy workflows | the backend's `scripts/resume-azure.sh` ([flight-assistant-backend](https://github.com/salih1f1/flight-assistant-backend)). This is the one command for a full restore |
| **Only the panel** | `scripts/resume-panel.sh` in this repo |
| To check the panel after a full restore | `scripts/resume-panel.sh` (the default dry run changes nothing and runs every check) |

The panel on its own loads and signs you in, but every page that needs data fails while the API is
stopped. Resume the panel alone only when that is what you want, for example to check the gate.

### scripts/resume-panel.sh

```sh
scripts/resume-panel.sh            # dry run: prints what it would do, changes nothing
scripts/resume-panel.sh --guided   # explains each step and asks y/n before each change
scripts/resume-panel.sh --apply    # makes the changes without asking
```

It is a bash script, so it runs from zsh as is. It needs `az` (signed in, with `flight-assistant`
as the default subscription) and, for the workflow step, `gh`. Each step checks the current state
first, so it is safe to run again. It does, in order:

1. **Preflight.** `az` is signed in, the default subscription is `flight-assistant` in the expected
   tenant. If not, it prints the `az login` / `az account set` line to run.
2. **Plan F1 → B1**, if it is on F1. The plan is **shared with the API**, so this restarts the bill
   (roughly $13 a month) for both apps, whether or not the API is running. B1 is also needed for
   Always On.
3. **Always On** on for the panel, then **start** it.
4. **Enable the *Deploy panel* workflow.** That deploys nothing by itself; the app serves the
   package from its last deploy. The script prints the `gh workflow run` line to redeploy `main`.
5. **Checks** (read-only):
   - Easy Auth is on and `allowedPrincipals.identities` is not empty.
   - **The gate's client secret** has not expired: it reads the gate's app registration through
     Graph in the CIAM tenant and warns under 30 days. This needs a token for that tenant, so the
     first time it asks you to run
     `az login --tenant <CIAM tenant> --allow-no-subscriptions && az account set --subscription a39b9c33-675b-40ca-84fc-6e548ef6d6c5`.
   - **Your public IP** against the panel's access restrictions. If no rule allows it, it prints the
     `access-restriction add` command; `--guided` offers to run it. `--apply` never adds a rule on
     its own.
   - The SCM (deploy) site does not inherit the main site's IP rules.
   - **The panel URL** answers an anonymous request with a 302 to the Easy Auth sign-in. After a
     start it waits for the container to warm up (a 503 or a timeout for the first minute or so is
     normal).

With the backup kit mounted, it appends a dated section to `LOG.md`: each change with its undo, and
each check's result. A dry run writes nothing, not even there.

## Pausing the panel again

```sh
scripts/pause-panel.sh             # dry run
scripts/pause-panel.sh --guided    # or --apply
```

The reverse of `resume-panel.sh`, for the panel only. The full pause of the environment is the
backend's job.

1. **Exports the panel's settings** into `01-azure-export/` in the backup kit, as
   `flight-assistant-dev-panel.{show,config,appsettings,access,identity,authv2}.json`. An existing
   file that has changed is kept beside the new one with a timestamp. Outside a dry run it **stops
   here** if the image is not mounted or any export failed, so the app is never stopped without a
   current backup.
2. Always On off (F1 refuses it), then **stops** the panel.
3. **Disables the *Deploy panel* workflow**, so a push to `main` does not deploy to a stopped app.
4. Moves the plan to **F1** only if the API is **already stopped with Always On off**. Otherwise the
   plan stays on B1 and keeps billing, and the script says why. It never changes the API and never
   deletes the plan.

Merge whatever is waiting for `main` **before** pausing: each merge deploys the panel, and the
deploy needs a running app and an enabled workflow.

## The backup kit

An encrypted sparse image in iCloud Drive:

```
iCloud Drive/Projects/Development/FlightAssistant/Azure-Pause-2026-09/fa-pause.sparseimage
```

```sh
hdiutil attach ~/Library/Mobile\ Documents/com~apple~CloudDocs/Projects/Development/FlightAssistant/Azure-Pause-2026-09/fa-pause.sparseimage
# -> mounted at /Volumes/FA-Pause (asks for the image password)
hdiutil detach /Volumes/FA-Pause    # when done
```

| In the image | What it is |
|---|---|
| `README.md` | Overview of the pause and the kit |
| `LOG.md` | Every step of the pause with its undo; the scripts append to it |
| `01-azure-export/` | `flight-assistant-dev-panel.{show,config,appsettings,access,identity,authv2}.json`, plus the backend's exports |

`authv2.json` holds the gate's allowlist (`allowedPrincipals.identities`) and its app
registration ID; the client secret itself stays in Key Vault, and the auth config only refers to
it. `appsettings.json` includes `CONTENT_SECURITY_POLICY`. The files are what rebuilds the panel
if its web app is ever deleted, so keep them in the image, not in your home directory.

## What the panel costs

The panel has **no bill of its own**. Every resource it uses is free, except the App Service plan
it shares with the API:

| Panel resource | Costs | While paused |
|---|---|---|
| Web app `flight-assistant-dev-panel` | Nothing by itself: App Service bills the **plan**, not the apps on it | Stopped |
| Its share of the plan | The whole B1 price (roughly $13 a month) while the plan is on B1, **whichever apps are running**. $0 on F1 | On F1 |
| Easy Auth, access restrictions, app settings | Free. They are part of the web app and survive a stop and a move to F1 | Kept |
| Gate app registration and its client secret (in `flightassistantdev-kv`) | Free | Kept. The secret still expires on its own date |
| The panel's own sign-in app registration (`VITE_B2C_CLIENT_ID`) | Free | Kept |
| GitHub Actions | Free within the account's included minutes | *Deploy panel* disabled, *CI* active |

So stopping the panel alone saves nothing; **the plan on F1 is what makes it $0.** The plan is not
deleted, because an app cannot exist without one: deleting the plan would mean rebuilding both apps,
including Easy Auth, IP rules and the deploy's federated credential.

## What protects the panel, and what goes wrong on resume

Three separate things have to agree before a page loads (README → Deployment has the full story):

| Layer | What it checks | Symptom when it fails |
|---|---|---|
| Access restrictions | your IP is allowlisted, default action Deny | a flat **403** before any sign-in |
| Easy Auth | your account's object ID is in `allowedPrincipals.identities` | **403 — You don't have authorization to view this page** after signing in |
| The API | your access token carries the `admin` role (case-sensitive, on the access token) | the panel loads, then refuses every request |

- **Your IP changed.** Consumer ISPs rotate addresses. `resume-panel.sh` compares yours with the rules
  and prints the command; see also README → "When your public IP changes". **Never restrict the SCM
  site**: deploys reach it from GitHub runners whose IPs change every run.
- **The gate's client secret expired.** Sign-in then fails after the tenant step, and the error
  looks like an allowlist problem. Create a new secret on the gate's app registration (Entra,
  `flightassistantextid` → App registrations → the gate → *Certificates & secrets*) and put it into
  the Key Vault secret that the auth config's `clientSecretSettingName` app setting refers to. The
  gate lives in the CIAM tenant, not the subscription's, so `az` needs
  `az login --tenant <CIAM tenant> --allow-no-subscriptions` to see it.
- **A new admin.** Add their object ID to `allowedPrincipals.identities` **and** give the account the
  `admin` app role. The gate and the API check different things: passing the gate without the role
  gets a panel that loads and then refuses every request.
- **Every auth configuration change restarts the auth container**, which takes a minute or more to
  warm up. A timeout right after changing auth settings is the restart, not a fault.

## If the panel's web app is ever deleted

It was not, but if it happens: follow `docs/superpowers/specs/2026-09-19-panel-azure-deploy-design.md`
to recreate the web app **with the same name** on the same plan, then restore from the kit's
`01-azure-export/`: app settings, IP rules, and the auth config (`az rest --method PUT` to
`…/config/authsettingsV2?api-version=2022-03-01` with the body of
`flight-assistant-dev-panel.authv2.json`). The deploy's federated credential is on the deploy
identity, not the app, so it survives, but only works if the app has the same name again. Then
check the gate's client secret as above.

## The database and the API

Both are the backend's side, and `scripts/resume-azure.sh` there restores them. Until they are
back, the panel's pages that need data fail, and so do the backend's local launch profiles that
read the dev database through Key Vault; the backend's `docker compose up -d` is the local
alternative.
