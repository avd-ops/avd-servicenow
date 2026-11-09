---
status: accepted
date: 2026-11-09
decision-makers: [owner]
---

# ASN-0001. Add ServiceNow as an optional ITSM, CMDB, and Change-Gate tier (`avd-servicenow`)

## Context and Problem Statement

Enterprise Azure Virtual Desktop estates frequently rely on ServiceNow as their system of record for CMDB/CSDM configuration items, Incident and Problem tracking, Change Management approvals, and Day-2 Service Catalog requests. Under [avd-second-brain decision 0023](https://github.com/avd-ops/avd-second-brain/blob/main/docs/knowledge/decisions/0023-family-format-best-open-source-or-build.md), the core `avd-ops` repositories must stay 100% open-source and runnable from a free GitHub account with zero standing third-party dependencies. How should ServiceNow fit into the `avd-ops` family?

## Decision Outcome

Build `avd-servicenow` as an **opt-in partner/ecosystem tier** (alongside `avd-liquidware`) and relax the family partner rule to name both **Liquidware** and **ServiceNow** as optional ecosystem tiers.

1. **Downward dependencies only:** `avd-servicenow` consumes pinned `avd-assess`, `avd-current-state`, `avd-second-brain`, and `avd-swarm` contracts (`C6`, `C8`, `C11`, `C15`, `C21`, `C24`) and defines `avd-itsm-sync-envelope/v1` (`C26` candidate). No core repo requires `avd-servicenow`.
2. **Private until launch:** `avd-servicenow` starts as a private repository (`nickprignano/avd-servicenow`) built to public-safe rules so it can move cleanly to `avd-ops/avd-servicenow` at launch. While private, no public `avd-ops` repository links to or names it.
3. **Governance and security preserved:** ServiceNow tickets are treated as untrusted input (`threadStartedBy: alert`, `V1-4`), outbound payloads are pseudonymized by default (`SN4`) and deduplicated by `correlation_id` (`SN5`), and ServiceNow Change approvals co-sign rather than bypass `avd-swarm`'s deterministic gate (`SN3`).
