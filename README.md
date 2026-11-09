# avd-servicenow

Part of [avd-ops](https://avd-ops.dev/), the open toolkit for Azure Virtual Desktop. Optional ServiceNow ITSM, CMDB/CSDM, and Change-Gate tier.

> [!WARNING]
> **Personal project. Research and learning only. Not for production. No warranty.**
>
> - This is my own personal project, built on my own time **for research and learning**. It is **not affiliated with, endorsed by or supported by my employer, ServiceNow, Liquidware or Microsoft**, and it does not represent their views, products or guidance.
> - **Do not run any of it in production** or against subscriptions, tenants, or ServiceNow instances that matter. Test it first in a dedicated lab subscription and a free ServiceNow Personal Developer Instance (PDI).
> - It is provided **"as is", without warranty of any kind**, under the [MIT License](LICENSE). You use it at your own risk.
> - **Contributions and forks are welcome and encouraged.**

## Role in avd-ops

Under [avd-second-brain decision 0023](https://github.com/avd-ops/avd-second-brain/blob/main/docs/knowledge/decisions/0023-family-format-best-open-source-or-build.md), the core `avd-ops` family runs 100% open-source with zero paid third-party service required. `avd-servicenow` provides the opt-in ServiceNow integration tier for enterprise estates where ServiceNow is the system of record for CMDB, Incident/Problem Management, Change Governance, and Service Catalog.

See [docs/spec.md](docs/spec.md) and [docs/guardrails.md](docs/guardrails.md) for the full design.

## Modules

1. **CMDB & CSDM IRE Sync (`cmdb/`):** Pure, offline-tested transforms from `C11` (`avd-current-state-facts`) into ServiceNow Identification and Reconciliation Engine (`/api/now/identifyreconcile`) payloads (`cmdb_ci_cloud_host_pool`, `cmdb_ci_vm_instance`, `cmdb_ci_appl`, `cmdb_ci_cloud_storage_account`, and CSDM technical service relationships).
2. **Assessment & Drift Problem/Change Sync (`assess-sync/`):** Maps `C21` (`avd-assessment-report/v1`) gaps into deduplicated ServiceNow `problem` records (`correlation_id: avd-ops:c21:<estate>:<check-id>`) and `C24` (`avd-remediation-plan/v1`) waves into phased `change_request` records.
3. **`avd-swarm` Incident & Change-Gate Adapter (`adapters/servicenow/`):**
   - **Inbound (`incident: servicenow`):** Keyless queue-backed runbook trigger (`threadStartedBy: alert`, enforcing `V1-4` provenance and Prompt Shields scanning).
   - **Outbound (`change-gate: servicenow`):** Mirrors `propose_change` plans into ServiceNow Change Requests whose approval co-signs the GitHub Environment `approve` gate without bypassing deterministic policy, live state-hash checks, or the kill switch.
4. **Day-2 Service Catalog & Workbench (`catalog/` & `site/portal/`):** ServiceNow Catalog Item templates wired to `avd-power-platform` fulfillment flows, plus an interactive browser workbench for previewing IRE batches, CSDM graphs, and redacted Known Error (`kb_template_known_error`) drafts.

## Validate locally

```bash
node --test "tests/*.test.mjs"
```

## License and disclaimer

[MIT](LICENSE). Personal project, not for production, provided as is, not affiliated with the author's employer, ServiceNow, Liquidware or Microsoft. ServiceNow is a registered trademark of ServiceNow, Inc.