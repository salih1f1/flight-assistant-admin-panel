# Pausing the dev environment in Azure, and bringing it back

How to take the Azure dev environment (API, panel, database) down to **$0 a month** without losing
data, and how to bring it back. Written 2026-09-25 and not yet run. Check each command's output
before running the next one.

Names used below:

| Thing | Name |
|---|---|
| Resource group | `flight-assistant-dev` |
| App Service plan (B1, shared by both apps) | `ASP-flightassistantdev-88a9` |
| API | `flight-assistant-dev-api` |
| Panel | `flight-assistant-dev-panel` |
| Key Vault | `flightassistantdev-kv` |
| DB connection string (Key Vault secret) | `PostgresConnectionString` |

The PostgreSQL server's name is not written down anywhere in the repos. Step 0 finds it.

## What costs money, and what to do with each

| Resource | Billed while it exists? | To reach $0 | Data kept? |
|---|---|---|---|
| App Service plan B1 | **Yes, every hour, even with both apps stopped** | Stop the apps, then scale the plan to **F1 (Free)** | Yes. Apps, settings, Easy Auth, IP rules and the deploy credentials all stay |
| PostgreSQL Flexible Server | Compute stops when you stop the server, but **storage and backups are still billed**. Azure also **restarts a stopped server automatically after 7 days** | **Dump the database, then delete the server** | Yes, in the dump file |
| Azure Cache for Redis (only if one exists) | Yes. It cannot be stopped | Delete it | The cache only. The API falls back to an in-memory cache when `ConnectionString:Redis` is missing |
| Key Vault | Per operation, so about $0 once nothing calls it | Keep it | Yes |
| Application Insights / Log Analytics | Per GB ingested, so $0 once the apps are stopped | Keep it | Logs age out as usual |
| Storage accounts | A few cents a month | Keep them | Yes |
| Entra External ID tenant | Free under 50k monthly active users | Keep it | Yes |
| Budget, managed identities, app registrations | Free | Keep them | — |

Outside Azure: once the API is stopped, nothing calls **AeroAPI** (FlightAware) or **AeroDataBox**.
If either one is a paid monthly subscription rather than pay-per-use, cancel it on the provider's
site.

**What happens to the test data:** it survives in the dump file (step 3) and nowhere else. After
step 4 deletes the server, Azure can restore it from its own backups only for a few days (the
backup retention period, 7 days by default). Treat the dump as the only copy, and keep it in two
places, for example your laptop and a cloud drive.

**Local runs:** the API's local launch profiles read the same dev database through Key Vault, so
they stop working too. Until you resume, use `docker compose up -d` in the backend and point
`PostgresConnectionString` at `localhost` in user secrets. You can load the same dump into it (see
"Resume", step 2).

## Pause

You need the `az` CLI signed in to the subscription (`az login`), and `pg_dump` from **PostgreSQL 16
or later** (at least the server's major version; step 0 prints it).

### 0. See what exists

```sh
RG=flight-assistant-dev
az resource list -g "$RG" -o table
az postgres flexible-server list -g "$RG" --query "[].{name:name,version:version,sku:sku.name,state:state}" -o table
az redis list -g "$RG" -o table   # probably empty
```

Save the server's name, and keep a record of how it was configured so you can rebuild it the same way:

```sh
PG=<server name from above>
mkdir -p ~/fa-pause && cd ~/fa-pause
az postgres flexible-server show -g "$RG" -n "$PG" > pg-server.json
az postgres flexible-server firewall-rule list -g "$RG" -n "$PG" > pg-firewall.json
az postgres flexible-server db list -g "$RG" -s "$PG" -o table
az webapp config access-restriction show -g "$RG" -n flight-assistant-dev-panel > panel-ip-rules.json
```

If `az resource list` shows anything not covered in the table above, check its pricing before
continuing.

### 1. Stop the apps

This stops the background jobs, so nothing polls AeroAPI and nothing writes to the database
while you dump it.

```sh
az webapp stop -g "$RG" -n flight-assistant-dev-api
az webapp stop -g "$RG" -n flight-assistant-dev-panel
```

### 2. Move the plan to the Free tier

```sh
az webapp config set -g "$RG" -n flight-assistant-dev-api   --always-on false
az webapp config set -g "$RG" -n flight-assistant-dev-panel --always-on false
az appservice plan update -g "$RG" -n ASP-flightassistantdev-88a9 --sku F1
```

If Azure refuses F1 (a feature in use that Free does not support, or a Free Linux plan already in
that region), the error names the reason. You can then either fix the named feature, or leave the
plan on B1. B1 costs roughly $13 a month, which would then be the only thing you still pay for.
Deleting the plan would get you to $0, but you would have to set both apps up again from scratch,
including Easy Auth, IP rules and the deploy's federated credentials. That is far more work to undo.

### 3. Dump the database

Get the connection details from Key Vault. **Do not paste the output anywhere**, because it
contains the password:

```sh
az keyvault secret show --vault-name flightassistantdev-kv -n PostgresConnectionString --query value -o tsv
```

It is an Npgsql string: `Host=…;Database=…;Username=…;Password=…`. Allow your IP through the
server's firewall, then dump:

```sh
az postgres flexible-server firewall-rule create -g "$RG" -n "$PG" \
  --rule-name pause-dump --start-ip-address "$(curl -s https://api.ipify.org)" --end-ip-address "$(curl -s https://api.ipify.org)"

PGPASSWORD='<password>' pg_dump -Fc --no-owner --no-privileges \
  -h "$PG.postgres.database.azure.com" -U '<username>' -d '<database>' \
  -f flightassistant-dev-$(date +%F).dump
```

**Check that the dump is complete before deleting anything.** The file should list tables,
including `__EFMigrationsHistory`:

```sh
pg_restore --list flightassistant-dev-*.dump | grep -c "TABLE DATA"
pg_restore --list flightassistant-dev-*.dump | grep __EFMigrationsHistory
```

A second check: load the dump into the backend's local Postgres (`docker compose up -d`, then
`pg_restore --no-owner -h localhost -U fa -d flightassistant --clean --if-exists <file>`, password
`fa`) and look at a few tables.

Copy the dump **and** the `.json` files from step 0 somewhere other than your laptop.

### 4. Delete the database server

```sh
az postgres flexible-server delete -g "$RG" -n "$PG" --yes
az redis delete -g "$RG" -n <cache name> --yes   # only if step 0 listed one
```

### 5. Check the bill

Cost Management → Cost analysis, grouped by resource, the next day. Charges lag by up to a day.
The panel's own Azure budget view is unavailable while the API is stopped.

## Resume

### 1. Recreate the database server

**Reuse the old server's name, admin username and password.** The Key Vault secret then stays
correct, and nothing else needs changing. Take the version, SKU, storage size and location from
`pg-server.json`:

```sh
az postgres flexible-server create -g "$RG" -n "$PG" \
  --location <location> --version <version> \
  --tier <tier> --sku-name <sku> --storage-size <GiB> \
  --admin-user '<username>' --admin-password '<password>' \
  --public-access None
az postgres flexible-server db create -g "$RG" -s "$PG" -d '<database>'
```

Recreate the firewall rules from `pg-firewall.json`. The API needs the "allow Azure services" rule
(`0.0.0.0`–`0.0.0.0`) if the old server had it. Add your own IP too, for the restore.

If Azure says the name is taken (deleted names can be held for a while), choose a new name and
update the secret to match. Then the API will pick it up on start:

```sh
az keyvault secret set --vault-name flightassistantdev-kv -n PostgresConnectionString \
  --value 'Host=<new>.postgres.database.azure.com;Database=<db>;Username=<user>;Password=<pw>;SSL Mode=Require'
```

(Copy the other parts of the string, such as SSL mode and pooling, from the old value.)

### 2. Restore the data

```sh
PGPASSWORD='<password>' pg_restore --no-owner --no-privileges \
  -h "$PG.postgres.database.azure.com" -U '<username>' -d '<database>' flightassistant-dev-<date>.dump
```

The dump includes `__EFMigrationsHistory`, so the API sees an up-to-date schema. If the backend
has gained migrations since the pause, it applies them the way it normally does.

### 3. Bring the apps back

```sh
az appservice plan update -g "$RG" -n ASP-flightassistantdev-88a9 --sku B1
az webapp start -g "$RG" -n flight-assistant-dev-api
az webapp start -g "$RG" -n flight-assistant-dev-panel
```

Turn Always On back on only if it was on before, because it keeps the background jobs running
around the clock. The panel's Health page says whether it is on.

### 4. Check it works

- `https://flight-assistant-dev-api.azurewebsites.net/health/ready` answers 200.
- The panel loads. A flat `403` means your IP has changed: see the README, "When your public IP
  changes".
- The panel's Health page shows the database, the jobs and the data sources as healthy.
- Remove the `pause-dump` firewall rule if it was recreated.
