import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  normalizeInstanceUrl,
  parseSnowJsonResponse,
  pushSyncEnvelopeToPdi
} from '../scripts/pdi-client.mjs';
import { createMockPdiServer } from '../scripts/mock-pdi-server.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = require('../site/portal/servicenow-core.js');

const c11 = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/c11-contoso.json'), 'utf8'));
const c21 = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/c21-contoso.json'), 'utf8'));
const c24 = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/c24-contoso.json'), 'utf8'));

test('normalizeInstanceUrl strips login_redirect.do paths and enforces https except for local MockPdi', () => {
  assert.equal(
    normalizeInstanceUrl('https://contoso.service-now.com/login_redirect.do?sysparm_stack=no'),
    'https://contoso.service-now.com'
  );
  assert.equal(
    normalizeInstanceUrl('http://127.0.0.1:8799/api/now/table'),
    'http://127.0.0.1:8799'
  );
  assert.throws(
    () => normalizeInstanceUrl('http://contoso.service-now.com'),
    /must use https:\/\//
  );
});

test('parseSnowJsonResponse detects PDI hibernation and login redirect HTML (red-team M2)', () => {
  assert.throws(
    () =>
      parseSnowJsonResponse(
        200,
        'text/html; charset=utf-8',
        '<html><body><h1>Your Personal Developer Instance is hibernating</h1></body></html>'
      ),
    /PDI_HIBERNATING_OR_AUTH_REDIRECT/
  );
});

test('pushSyncEnvelopeToPdi runs end-to-end against Mock-PDI server with idempotent Problem/Change reconciliation', async () => {
  const { server, state } = createMockPdiServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const instanceUrl = `http://127.0.0.1:${port}`;
  const authHeader = 'Bearer test-mock-token';

  try {
    const env1 = core.buildSyncEnvelope({
      estateSlug: 'contoso-prod',
      allowEstateIdentifiers: false,
      c11,
      c21,
      c24
    });

    // Run 1: creates 7 CMDB CIs, 2 Problems, 2 Change Requests
    const res1 = await pushSyncEnvelopeToPdi(env1, { instanceUrl, authHeader });
    assert.equal(res1.cmdbItemsReconciled, 7);
    assert.equal(res1.problems.created, 2);
    assert.equal(res1.problems.noop, 0);
    assert.equal(res1.changeRequests.created, 2);
    assert.equal(state.problems.size, 2);
    assert.equal(state.changeRequests.size, 2);

    // Run 2 with same state: 0 duplicate Problems or Change Requests created (H1 / SN5)
    const res2 = await pushSyncEnvelopeToPdi(env1, { instanceUrl, authHeader });
    assert.equal(res2.problems.created, 0);
    assert.equal(res2.problems.noop, 2);
    assert.equal(res2.changeRequests.created, 0);
    assert.equal(res2.changeRequests.noop, 2);
    assert.equal(state.problems.size, 2);

    // Run 3: AZ-NET-004 flips to pass -> resolves existing Problem in PDI
    const c21Fixed = JSON.parse(JSON.stringify(c21));
    c21Fixed.checks[0].status = 'pass';
    const env3 = core.buildSyncEnvelope({
      estateSlug: 'contoso-prod',
      allowEstateIdentifiers: false,
      c11,
      c21: c21Fixed,
      c24,
      existingProblems: [
        {
          correlationId: 'avd-ops:c21:contoso-prod:AZ-NET-004',
          state: 'open',
          severity: 'high',
          shortDescription: '[AVD Drift] AZ-NET-004: RDP Shortpath UDP 3390 blocked on session host subnet'
        }
      ]
    });
    const res3 = await pushSyncEnvelopeToPdi(env3, { instanceUrl, authHeader });
    assert.equal(res3.problems.resolved, 1);

    // Verify hibernation mode is caught over HTTP
    await fetch(`${instanceUrl}/__hibernate`, {
      method: 'POST',
      body: JSON.stringify({ hibernating: true })
    });
    await assert.rejects(
      () => pushSyncEnvelopeToPdi(env1, { instanceUrl, authHeader }),
      /PDI_HIBERNATING_OR_AUTH_REDIRECT/
    );
  } finally {
    server.close();
  }
});
