# 0001. PDI sign-in redirect URLs, HTTP 200 hibernation HTML, WP5 adapter YAML parsing, and PowerShell single-item array unrolling

- **Area:** ServiceNow REST API (`scripts/pdi-client.mjs`), `avd-swarm` WP5 adapter manifest (`adapters/servicenow/adapter.yml`), PowerShell 7 (`scripts/AvdServiceNow.psm1`)
- **Found in / fixed by:** PRs #1–#5 (`avd-ops/avd-servicenow`), PR #88 (`avd-ops/avd-swarm`)

## What happened
Four issues surfaced while building and testing the ServiceNow ITSM, CMDB/CSDM, and Change-Gate tier (`avd-servicenow`) and registering its WP5 adapter in `avd-swarm`:

1. **PDI sign-in redirect URLs:** When copying a newly provisioned Personal Developer Instance (PDI) URL from a browser tab before or during first sign-in, the address bar holds `https://<instance>.service-now.com/login_redirect.do?sysparm_stack=no` rather than the bare origin. Concatenating `/api/now/...` onto a raw string produces a broken path (`/login_redirect.do?sysparm_stack=no/api/now/table/problem`).
2. **Hibernating or unauthenticated PDIs return HTTP `200 OK` with HTML (`M2`):** A hibernating ServiceNow PDI (or an instance redirecting to interactive sign-in) responds to `/api/now/table/*` and `/api/now/identifyreconcile` with HTTP status `200 OK` and an HTML page (`<!DOCTYPE html>...Instance Hibernating` or `login_redirect.do`) instead of JSON. Calling `res.json()` directly throws an opaque `SyntaxError: Unexpected token '<'`.
3. **`avd-swarm` WP5 adapter checker (`scripts/check_adapters.py`) rules:** Running `python3 scripts/check_adapters.py` in `avd-swarm` against the initial `adapters/servicenow/adapter.yml` failed with three findings:
   - Missing companion `adapters/servicenow/README.md` (every `adapters/<name>/` folder must contain both `adapter.yml` and `README.md`).
   - Unquoted `: ` inside `identity.policyDeny` (`... correlation_id STARTSWITH avd-ops:`), which `check_adapters.py`'s minimal line-by-line YAML parser split on `: `.
   - Unknown `switch` key `stop-spend`: `check_adapters.py` checks `switch` keys against `POSITIONS` from `gateway/avd_gateway/flag.py` plus `residual` (`run`, `halt-actions`, `halt-agents`, `halt-all`, `residual`).
4. **PowerShell 7 single-element array unrolling on JSON serialization:** In `New-AvdServiceNowSyncEnvelope` (`scripts/AvdServiceNow.psm1`), returning a 1-element array from a helper function or pipeline unrolled `problems` or `changeRequests` into a scalar hashtable under `ConvertTo-Json -Depth 10`, violating the `avd-itsm-sync-envelope/v1` JSON Schema (`type: "array"`).

## Why
1. ServiceNow redirects unauthenticated browser sessions to `/login_redirect.do?sysparm_stack=no`, which operators naturally copy from the address bar.
2. ServiceNow PDIs hibernate after inactivity on the developer program tier and serve a wakeup HTML interstitial with status `200` on REST paths until woken via `https://developer.servicenow.com/`.
3. `avd-swarm/scripts/check_adapters.py` uses a zero-dependency line parser (`key, _, rest = text.partition(":")`) and enforces exact match against the 4 kill-switch positions in `flag.py` plus `residual`.
4. PowerShell's pipeline unrolls single-element arrays returned from functions unless wrapped in `@(...)` at assignment or constructed on the parent hashtable/object with explicit array coercion.

## Fix
1. Added `normalizeInstanceUrl(rawUrl, options)` in `scripts/pdi-client.mjs` using `new URL(trimmed)` to validate the scheme (`https:` required unless `allowHttpLocalhost: true` is set for `-Mode MockPdi` on `127.0.0.1`/`localhost`) and return `parsed.origin`, stripping any `/login_redirect.do` path, query string, or fragment.
2. Added `parseSnowJsonResponse(statusCode, contentType, bodyText)` in `scripts/pdi-client.mjs` to inspect `Content-Type` and leading `<html`/`<!doctype` before `JSON.parse`, throwing a clear error distinguishing PDI hibernation (`ServiceNow PDI is hibernating (HTTP 200 HTML returned)...`) from sign-in redirect HTML.
3. Quoted all scalar strings containing colons in `adapters/servicenow/adapter.yml`, aligned `switch` keys to `run`, `halt-actions`, `halt-agents`, `halt-all`, and `residual`, and added `adapters/servicenow/README.md`.
4. Forced `@(...)` array wrapping on `problems`, `changeRequests`, `knownErrorDrafts`, and `cmdbIreBatch.items`/`relations` inside `New-AvdServiceNowSyncEnvelope` in `scripts/AvdServiceNow.psm1`.

## Guard
- `tests/pdi-harness.test.mjs` (`normalizeInstanceUrl strips login_redirect.do paths and enforces https except for local MockPdi`, `parseSnowJsonResponse detects PDI hibernation and login redirect HTML (red-team M2)`, and end-to-end `MockPdi` upsert/idempotency tests).
- `tests/bootstrap.test.mjs` (`adapters/servicenow/adapter.yml satisfies avd-swarm WP5 adapter invariants` and leak scan refusing non-`contoso.service-now.com` instance hostnames).
- `avd-swarm/scripts/check_adapters.py` (`6 adapters checked, 0 findings`).

## Rule
Always normalize ServiceNow instance URLs to `new URL(raw).origin`, check `/api/now/*` responses for HTTP 200 hibernation/login HTML before parsing JSON, quote scalar strings containing colons in `avd-swarm` `adapter.yml` manifests, and wrap array properties in `@(...)` at object construction time in PowerShell before calling `ConvertTo-Json`.
