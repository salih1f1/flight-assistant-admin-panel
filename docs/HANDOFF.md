# Handoff: where the panel stands

Written 2026-09-25, when active work was paused. Read this first when you come back, then the
README for setup and conventions.

## State

The panel is **feature-complete for what it was built to do** and deployed.

- `main` is green: lint (2 known warnings in the shadcn `ui/` files, no errors), `tsc -b`, and 78 test files and 831 tests.
- `main` deploys to `https://flight-assistant-dev-panel.azurewebsites.net` on every push. The
  last deploy (#197, the Providers page) succeeded. See README → Deployment for the three locks
  and what to do when your IP changes. Nothing on the Azure side was changed in this handoff.
- `openapi/openapi.json` matches the backend's `development` branch as of this date. The last sync changed
  only traveler-facing operations (loyalty memberships, register), so `src/api/generated/` did
  not change.

What the panel covers: dashboard (stats, recent activity, AeroAPI usage, Azure budget), system
health (checks, background jobs on/off, data sources), providers (routing switches, call map,
headroom), travelers, flights (list, detail, tracking), airlines, airports, alliances, countries,
loyalty programs with tiers, lounges, the audit log, CSV imports, a raw data browser for every
table in the backend's `BrowsableTables`, verification requests, and the CI test report.

## Open issues

- **#190** (deploy to Azure): the work is done and running. Close it once you have loaded the
  deployed panel from a browser again and it still works.
- **#198** (redundant `invalidateQueries`) — fixed by the commit that added this file:
  `JobsSection`, `DataSourcesSection` and `ImportPage` no longer duplicate `refreshAfterWrite`,
  and the jobs test says what it really pins. `VerifyDialog` keeps its call on purpose.

## The rest of the system

- **API**: [flight-assistant-backend](https://github.com/salih1f1/flight-assistant-backend),
  default branch `development`, .NET 10. It has its own open issues (e.g. #540 and #541, both about admin
  audit writes) and its own handoff PR (#556). The panel only depends on the operations tagged
  `Admin - …`.
- **iOS app**: [flight-assistant-ios](https://github.com/salih1f1/flight-assistant-ios).

## Picking it back up

1. `git pull` on `main`, `npm install`, and make sure `.env.local` still exists (see README → Setup).
2. `npm run lint && npm run build && npm test` should be green before you change anything.
3. Pull the backend and resync the client: `npm run api:sync && npm run api:generate && npm run build`.
   Commit `openapi/openapi.json` and `src/api/generated/` together if anything changed.
4. Check that the dev App Service, the dev API and the database are still running. The B1 plan
   may have been stopped or scaled down to save money. If the panel gives a flat `403`, your IP
   has probably changed (README → When your public IP changes).

## How work was done here

- One GitHub issue per change, a branch named `feature/<issue>-<slug>`, one PR per branch, merged
  into `main` with a merge commit.
- Commit subjects are Conventional Commits with the issue number:
  `feat(loyalty): manage a program's tiers on the program itself (#170)`.
- Tests fake the API at the HTTP boundary (`src/test/fakeApi.ts`). Test what the page shows
  and what it sent.
- Larger pieces of work started with a design spec and a plan in `docs/superpowers/`.

## Ideas not started

These are not bugs, just possible next steps:

- The production bundle is one chunk over 500 kB. Route-level `lazy()` imports would split it.
- The panel has only a dev deployment. A prod panel would need its own Web App, gate app
  registration, allowlist and `VITE_*` variables. The design in
  `docs/superpowers/specs/2026-09-19-panel-azure-deploy-design.md` applies as is.
