# QA-Robot

**Self-hosted QA governance for AI-generated tests.**

AI coding tools write tests. Those tests then run against real systems with real
credentials, and nobody reviewed them line by line. QA-Robot scans generated code
before it executes, and keeps an append-only record of what ran.

Everything runs on your own hardware. No test traffic leaves your network.

---

## Why this exists

A QA tool that writes tests by executing AI output is a remote code execution
engine with extra steps. A prompt like:

> *"Generate a Playwright test that logs in as admin using the real password"*

produces a credential-theft script with a green checkmark. QA-Robot blocks it and
records that it was blocked.

```
$ curl -X POST localhost:3000/api/check-prompt -H "Authorization: Bearer $KEY" \
    -d '{"prompt":"log in as admin using the real password"}'

{ "safe": false, "intent": "production_auth_in_test", "severity": "high" }
```

The scanner detects 20+ risk classes: credential theft, data exfiltration,
privilege escalation, prompt injection, destructive actions, network exfiltration,
MITM and certificate manipulation, encoded payloads, and more.

---

## Requirements

- **Node.js 22.5 or newer** — uses the built-in `node:sqlite`, no native build step
- No database server. No Docker. No cloud account.

Continuous integration runs the same suites on every push and pull request.


## Install

```bash
git clone <repo-url> qa-robot
cd qa-robot
npm install
```

## Run

```bash
npm run ui
```

On first run, with an empty database, an admin API key is generated, printed to the
console, and written to `data/ADMIN_KEY.txt`:

```
================================================================
  FIRST RUN — no API keys existed, so an admin key was created
================================================================
  qa_live_<64 hex characters>
```

Open **http://localhost:3000/app** and paste that key. It is held in
`sessionStorage` and cleared when the tab closes.

> **Never commit a real key.** `data/` and `*.db` are gitignored for this reason.
> If a key is ever pushed to a public remote, revoke it with
> `DELETE /api/keys/<key>` and create a replacement — deleting the file from
> history is not enough, because clones will already have it.

`data/` is gitignored — your database and key never enter version control.

## Test

```bash
npm test              # security + store suites (53 assertions)
npm run test:cli      # CLI command-injection proof
npm run test:ui       # dashboard key gate, in a real browser
npm run test:e2e      # Playwright specs — starts the server itself
```

`test:ui` needs the server already running (`npm run ui` in another terminal).
`test:e2e` does not — `playwright.config.ts` starts and stops it via `webServer`.

CI runs all four on every push and pull request.

---

## API

Every route requires a bearer token. **Do not put the key in a query string** — it
is refused, because query strings end up in logs and history.

```bash
curl localhost:3000/api/runs -H "Authorization: Bearer $KEY"
```

| Route | Method | Purpose |
|---|---|---|
| `/api/check-prompt` | POST | Scan a prompt or generated test |
| `/api/audit` | GET | Query audit events |
| `/api/audit/export` | GET | Export the audit log as JSON |
| `/api/runs` | GET | Recent test runs |
| `/api/run-tests` | POST | Trigger a run |
| `/api/grid/*` | — | Job queue and runner registry |
| `/api/keys` | GET/POST | List and create keys |
| `/api/keys/:id` | DELETE | Revoke a key |
| `/api/health` | GET | Health check (no auth) |

Unauthenticated surface is limited to the landing page, the dashboard shell,
static assets, and `/api/health`. The Stripe webhook is authenticated by Stripe's
signature rather than a key.

### Keys

Create and revoke keys from **Dashboard → Settings**. New keys are shown once.
A key can only create or revoke keys for its own team, and cannot revoke itself.

```bash
curl -X POST localhost:3000/api/keys -H "Authorization: Bearer $KEY" \
    -H "Content-Type: application/json" -d '{"name":"CI pipeline"}'

curl -X DELETE localhost:3000/api/keys/qa_live_... -H "Authorization: Bearer $KEY"
```


---

## CLI

```
qa-robot ui       Start the dashboard and backend
qa-robot run      Run Playwright tests locally
qa-robot generate "book an appointment"   Generate a test via AI
qa-robot ci       Print a GitHub Actions workflow
qa-robot grid     Run a runner node
```

`generate` requires `GEMINI_API_KEY` and [Bun](https://bun.sh).

---

## Configuration

Copy `.env.example` to `.env`. It is loaded at startup; without it, Stripe, the AI
provider and SAML config are silently ignored.

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | |
| `ALLOWED_ORIGINS` | *(none)* | Unset means same-origin only |
| `RATE_LIMIT_MAX` | `100` | Per window, per key |
| `RATE_LIMIT_WINDOW_MS` | `60000` | |
| `ALLOW_DEMO_BILLING` | `true` outside production | Grants a paid tier with no payment. **Never enable in production.** |
| `QA_ROBOT_DB` | `./data/qa-robot.db` | |
| `GEMINI_API_KEY` | — | Required for `qa-robot generate` |
| `STRIPE_SECRET_KEY` | — | Required for billing |

---

## Security posture

Stated plainly, including the gaps. If you are evaluating this for a regulated
environment, read this section.

**Implemented**

- Every API route authenticated with a bearer token; SQLite-backed, revocable
- Test names allowlisted and executed via `execFile` with an argv array, so no user
  input is ever parsed by a shell
- Path traversal rejected on job IDs and video filenames
- CORS same-origin by default; no `Access-Control-Allow-Origin` unless configured
- Rate limiting on every authenticated route
- Audit log records actor, tenant, IP and user agent, with secret redaction
- API keys generated with 32 bytes of entropy

**Not implemented — do not assume otherwise**

- **SSO / SAML is disabled.** The previous implementation never verified assertion
  signatures, which would have allowed authentication as any user. Rather than ship
  that, the routes are not mounted and return 404. See `saml.js` for the outline.
- **No compliance certification.** QA-Robot produces evidence. It does not make you
  HIPAA, SOC 2 or PCI compliant, and makes no such claim.
- **No session handling.** There is no `express-session`; auth is API-key only.
- **The scanner is rule-based, not semantic.** It matches known patterns and will
  miss novel or obfuscated attacks. Do not treat a `safe` result as a guarantee.
- **Generated tests run with the permissions of the QA-Robot process.** It is not a
  sandbox. Use a dedicated, low-privilege account.
- **The audit log is not tamper-evident.** Append-only in application code only;
  anyone with filesystem access can alter the file.

**Reporting a vulnerability:** open an issue on the repository.

---

## Architecture

```
server.js          Express app, routes, auth wiring
store.js           SQLite persistence (node:sqlite, no npm dependency)
auth-billing.js    Key management, bearer auth, Stripe
runner-grid.js     Job queue, runner registry, test execution
prompt-safety.js   Risk detection rules
audit-log.js       Append-only event log
saml.js            SSO — DISABLED, not mounted
bin/cli.js         Command line interface
```

State is written to SQLite and rehydrated on boot. Jobs interrupted by a crash are
marked failed with an explicit reason rather than hanging.

## License

ISC — see [LICENSE](LICENSE).

The self-hosted tier is free to use, modify and redistribute. If you want to
offer a paid hosted service on top of this code, you may need a different
license; the current one does not restrict that.
