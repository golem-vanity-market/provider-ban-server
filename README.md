# provider-ban-server

Common ban server for the vanity-market requestor fleet — the missing piece
described in
[OPERATIONS.md §6b](https://github.com/golem-vanity-market/vanity-market-docs/blob/main/OPERATIONS.md)
(*"Common ban for all requestors"*).

Previously each of the requestors (`vanity-stone-0..9`) kept its own in-memory
ban list that lasted only one 8-hour cycle, so a failing provider got up to 10
independent initial-trust windows per cycle (OPERATIONS.md §5a). This server
makes a ban **fleet-wide**: a provider banned by any requestor is banned for
all of them, with **escalating durations** — the Nth non-revoked ban within
24 h lasts N hours (1 h, 2 h, 3 h, …, capped at `BAN_MAX_HOURS`, default
**24 h**). One slip costs an hour; repeat offenders wait longer each time.

## What it does

- **Collects** from every requestor node (from `nodes.json`, local port
  `6200+N` first, public proxy as fallback) every 30 s:
  - `GET /status` — per-agreement estimator records (agreement id, provider,
    work, cost, efficiency TH/GLM, speed, price GLM/h, duration),
  - `GET /providers/banned` — the node's current ban list; each newly seen
    provider gets a fleet-wide ban entry (idempotent: one active ban per
    provider+source, so a node resetting its local list does not restart the
    shared clock).
- **Seeds** history once from the gatherer's `estimators.json`
  (per-agreement records, ~7 days) so statistics are meaningful from day one.
- **Stores** everything in SQLite (`bun:sqlite`, WAL): providers, agreements,
  bans — history is kept indefinitely.
- **Scores** every provider 0–100 (efficiency vs target 35%, agreements
  without ban 25%, delivered volume 15%, time since last ban 15%, recently
  active 10%) and **categorizes**: `trusted / reliable / average /
  underperformer / new / blacklisted / banned` (thresholds in `template.env`).
- **Serves** a REST API and a Vite/React dashboard (providers, per-provider
  agreement list with efficiency and price per agreement, ban history, score
  breakdown, links to `stats.golem.network/network/provider/<id>`).

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/health` | liveness + last collection info |
| GET | `/api/v1/summary` | fleet totals, categories, node status |
| GET | `/api/v1/bans/active` | fleet-wide ban list (for requestors) |
| GET | `/api/v1/bans?providerId=&limit=&offset=` | ban history |
| POST | `/api/v1/bans` | report a ban `{providerId, reason?, source?, agreementId?, durationHours?}` |
| POST | `/api/v1/bans/:id/revoke` (or DELETE `/api/v1/bans/:id`) | revoke a ban |
| GET | `/api/v1/providers?sort=&dir=&category=&search=&limit=&offset=` | provider list with stats, score, category |
| GET | `/api/v1/providers/:id` | provider detail: agreements, per-agreement efficiency/price, bans, daily stats |
| GET | `/api/v1/providers/:id/agreements` | paged agreement list |
| GET | `/api/v1/portal/providers/:id` | public stats-portal view: compact status, targets, performance, price list and actionable `hints` (price cut needed to meet the efficiency target, ban escalation, speed advice) |
| GET | `/providers/banned` | same shape as the stone endpoint (compatibility) |

The requestor integration lives in `vanity-market-cli`
(`src/reputation/reputation.ts`): when `BAN_SERVER_URL` is set the Reputation
class pulls the shared list periodically and pushes its own bans to
`POST /api/v1/bans`.

## Run

```bash
bun install
bun run dev        # backend on :7710 (bun --watch)
bun run dev:web    # Vite dev server with /api proxy
bun run build      # build UI to dist/ (served by the backend too)
bun start          # production backend
```

Configuration: copy `template.env` to `.env` (all values optional — defaults
work on the production box).

## Deployment

Follows the stack conventions:

- `provider-ban-server.service` — runs `bun src/server/main.ts` on port 7710
  (systemd unit in `services/`, also tracked in `db-vanity-admin`).
- `provider-ban-server-gitploy.service` — auto-pull + `deploy.sh` on changes
  to `main`.
- `deploy.sh` — builds the UI with `VITE_BASE=/<hidden>/` and
  `VITE_API_BASE=/nmpdmxzhrm/ban-server`, copies `dist/` to
  `/var/www/html/<hidden>/`, restarts the service. Override the hidden path
  via a gitignored `.deploy.env`.
- nginx (site `stone.vanity.market`): the UI is served as static files under
  the hidden path; the API is proxied under
  `/nmpdmxzhrm/ban-server/ -> 127.0.0.1:7710`.

No login — deployed under a hidden link like the other internal services.
