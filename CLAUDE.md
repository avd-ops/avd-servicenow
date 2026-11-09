@AGENTS.md

# CLAUDE.md

`avd-servicenow`: the optional ServiceNow ITSM, CMDB/CSDM, and Change-Gate integration tier for the `avd-ops` family ([docs/spec.md](docs/spec.md)). It consumes pinned `avd-assess`, `avd-current-state`, `avd-second-brain`, and `avd-swarm` contracts (`C6`, `C8`, `C11`, `C15`, `C21`, `C24`) and emits deterministic, redacted ServiceNow IRE, Problem, Change, and Known Error payloads (`avd-itsm-sync-envelope/v1`).

## Validate before pushing

```bash
node --test "tests/*.test.mjs"
```

## Rules

- Dependencies point one way: downward into published `avd-ops` contracts at the commits pinned in `PINS.json`. No core `avd-ops` repo requires ServiceNow.
- Ticket text from ServiceNow (`short_description`, `description`, `comments`, `work_notes`) is always untrusted input (`threadStartedBy: alert`). It must pass through redaction and Prompt Shields before reaching any model, and under `avd-swarm` rule `V1-4` can never be the sole evidence for a write plan.
- Outbound payloads default to pseudonymized identifiers (`<pool-1>`, `<host-1>`, `<sub-1>`). Real ARM IDs and hostnames are emitted only in `cmdb/` IRE mode when `-AllowEstateIdentifiers` is explicitly passed by the operator.
- Every Problem, Incident update, and Change Request uses a deterministic `correlation_id` (`avd-ops:...`) so repeat runs reconcile state instead of flooding tickets.
- Personal project, not for production, as is, not affiliated with the author's employer, ServiceNow, Liquidware or Microsoft.
