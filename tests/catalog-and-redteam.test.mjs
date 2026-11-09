import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = require('../site/portal/servicenow-core.js');

test('docs/redteam.md documents Critical (C1-C3), High (H1-H5), Medium (M1-M4), and Strategic (S1) findings', () => {
  const redteamPath = path.join(ROOT, 'docs/redteam.md');
  assert.ok(fs.existsSync(redteamPath), 'docs/redteam.md must exist');
  const text = fs.readFileSync(redteamPath, 'utf8');
  for (const id of ['C1', 'C2', 'C3', 'H1', 'H2', 'H3', 'H4', 'H5', 'M1', 'M2', 'M3', 'M4', 'S1']) {
    assert.match(text, new RegExp(`\\b${id}\\b`), `docs/redteam.md missing finding ${id}`);
  }
});

test('catalog/catalog-items.json defines governed Day-2 catalog items wired to avd-power-platform workflows', () => {
  const catalogPath = path.join(ROOT, 'catalog/catalog-items.json');
  assert.ok(fs.existsSync(catalogPath), 'catalog/catalog-items.json must exist');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  assert.equal(catalog.schema, 'avd-servicenow-catalog/v1');
  assert.equal(catalog.targetControlPlane, 'avd-power-platform');
  assert.equal(catalog.items.length, 4);

  const workflows = catalog.items.map((item) => item.powerPlatformWorkflow);
  assert.ok(workflows.includes('RequestPoolAccess'));
  assert.ok(workflows.includes('SessionHostDrainAndRestart'));

  for (const item of catalog.items) {
    assert.equal(item.guardrails.requiresKillSwitchRun, true, `${item.id} must require kill switch run state`);
    assert.match(item.guardrails.idempotencyKeyPattern, /\^avd-ops:sc:RITM/);
  }
});

test('buildCatalogFulfillmentPayload enforces H5 idempotency key, kill-switch halt refusal, and justification redaction', () => {
  const okPayload = core.buildCatalogFulfillmentPayload({
    ritmNumber: 'RITM0042100',
    powerPlatformWorkflow: 'RequestPoolAccess',
    killSwitchState: 'run',
    targetCi: 'vdag-prod-desktop',
    justification: 'User alice@contoso.com on 10.24.8.15 needs access to vm-avd-p-1.contoso.com'
  });
  assert.equal(okPayload.idempotencyKey, 'avd-ops:sc:RITM0042100:RequestPoolAccess');
  assert.equal(okPayload.dispatchAllowed, true);
  assert.equal(okPayload.refusalReason, null);
  assert.doesNotMatch(okPayload.redactedJustification, /alice@contoso\.com/);
  assert.doesNotMatch(okPayload.redactedJustification, /10\.24\.8\.15/);

  const haltedPayload = core.buildCatalogFulfillmentPayload({
    ritmNumber: 'RITM0042101',
    powerPlatformWorkflow: 'SessionHostDrainAndRestart',
    killSwitchState: 'halt-actions',
    targetCi: 'vm-avd-p-1.contoso.com',
    justification: 'Drain and restart host'
  });
  assert.equal(haltedPayload.dispatchAllowed, false);
  assert.match(haltedPayload.refusalReason, /halt-actions/);
});
