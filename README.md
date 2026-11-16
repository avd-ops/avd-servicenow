# avd-servicenow

Part of [avd-ops](https://avd-ops.dev/), the open toolkit for Azure Virtual Desktop.

Optional ServiceNow ITSM, CMDB/CSDM, and Change-Gate tier for enterprise estates where ServiceNow is the system of record. Under [avd-second-brain decision 0023](https://github.com/avd-ops/avd-second-brain/blob/main/docs/knowledge/decisions/0023-family-format-best-open-source-or-build.md), the core `avd-ops` family runs 100% open-source with zero paid third-party service required; `avd-servicenow` is opt-in.

> [!WARNING]
> **Community research project. Use at your own risk. No warranty.**
>
> - This is my own personal project, built on my own time **for research and learning**. It is **not affiliated with, endorsed by or supported by my employer, ServiceNow, Liquidware or Microsoft**, and it does not represent their views, products or guidance.
> - Test it first in a dedicated lab subscription and tenant before using it in production; you are responsible for reviewing the code and validating it for your environment.
> - It is provided **"as is", without warranty of any kind**, under the [MIT License](LICENSE). You use it at your own risk.
> - **Contributions and forks are welcome and encouraged.** See [Contributing](#contributing).

## How it connects

| Direction | Repo | Relationship |
|---|---|---|
| Front door | [avd-ops](https://github.com/avd-ops/avd-ops#readme) | Overview and platform decisions |
| Upstream | [avd-current-state](https://github.com/avd-ops/avd-current-state#readme) | Supplies `C11` facts for CMDB & CSDM IRE sync (`cmdb/`) |
| Upstream | [avd-assess](https://github.com/avd-ops/avd-assess#readme) | Supplies `C21` / `C24` schemas for Problem and Change sync (`assess-sync/`) |
| Bidirectional | [avd-swarm](https://github.com/avd-ops/avd-swarm#readme) | Inbound incident triggers and outbound Change-Gate co-signing (`adapters/servicenow/`) |
| Downstream | [avd-power-platform](https://github.com/avd-ops/avd-power-platform#readme) | Wires ServiceNow Catalog Items to Power Platform fulfillment flows (`catalog/`) |
| Knowledge | [avd-second-brain](https://github.com/avd-ops/avd-second-brain#readme) | Drafts redacted Known Error (`kb_template_known_error`) entries |

## Modules

1. **CMDB & CSDM IRE Sync (`cmdb/`):** Pure, offline-tested transforms from `C11` (`avd-current-state-facts`) into ServiceNow Identification and Reconciliation Engine (`/api/now/identifyreconcile`) payloads (`cmdb_ci_cloud_host_pool`, `cmdb_ci_vm_instance`, `cmdb_ci_appl`, `cmdb_ci_cloud_storage_account`, and CSDM technical service relationships).
2. **Assessment & Drift Problem/Change Sync (`assess-sync/`):** Maps `C21` (`avd-assessment-report/v1`) gaps into deduplicated ServiceNow `problem` records (`correlation_id: avd-ops:c21:<estate>:<check-id>`) and `C24` (`avd-remediation-plan/v1`) waves into phased `change_request` records.
3. **`avd-swarm` Incident & Change-Gate Adapter (`adapters/servicenow/`):**
   - **Inbound (`incident: servicenow`):** Keyless queue-backed runbook trigger (`threadStartedBy: alert`, enforcing `V1-4` provenance and Prompt Shields scanning).
   - **Outbound (`change-gate: servicenow`):** Mirrors `propose_change` plans into ServiceNow Change Requests whose approval co-signs the GitHub Environment `approve` gate without bypassing deterministic policy, live state-hash checks, or the kill switch.
4. **Day-2 Service Catalog & Workbench (`catalog/` & `site/portal/`):** ServiceNow Catalog Item templates wired to [avd-power-platform](https://github.com/avd-ops/avd-power-platform#readme) fulfillment flows, plus an interactive browser workbench for previewing IRE batches, CSDM graphs, and redacted Known Error (`kb_template_known_error`) drafts.

## Validate locally

```bash
node --test "tests/*.test.mjs"
```

## Docs

- Specification: [docs/spec.md](docs/spec.md)
- Guardrails: [docs/guardrails.md](docs/guardrails.md)
- Red-team review: [docs/redteam.md](docs/redteam.md)
- Lessons learned: [docs/lessons/](docs/lessons/README.md)

## Contributing

Fork it, open an issue or a pull request. Follow [docs/guardrails.md](docs/guardrails.md): no instance URLs, tenant IDs, secrets, or customer names, and propose changes via pull request only. Contributions are accepted under the [MIT License](LICENSE).

## License and disclaimer

[MIT](LICENSE). Community research project, provided as is, use at your own risk, not affiliated with the author's employer, ServiceNow, Liquidware or Microsoft. ServiceNow is a registered trademark of ServiceNow, Inc.
