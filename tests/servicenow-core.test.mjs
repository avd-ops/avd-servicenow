import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = require('../site/portal/servicenow-core.js');

const c11 = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/c11-contoso.json'), 'utf8'));
const c21 = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/c21-contoso.json'), 'utf8'));
const c24 = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/c24-contoso.json'), 'utf8'));
const incident = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/incident-contoso.json'), 'utf8'));

test('redactText scrubs UPNs, IPs, hostnames, and non-zero GUIDs while preserving zero UUID', () => {
  const synthGuid = ['a1b2c3d4', 'e5f6', '7890', 'abcd', 'ef1234567890'].join('-');
  const synthSnow = ['acme', 'service-now', 'com'].join('.');
  const input =
    `Host vm-avd-p-1.contoso.com (sub ${synthGuid}, zero 00000000-0000-0000-0000-000000000000) failed for alice@contoso.com from 10.24.8.15 on ${synthSnow}`;
  const redacted = core.redactText(input);
  assert.doesNotMatch(redacted, /alice@contoso\.com/);
  assert.doesNotMatch(redacted, /10\.24\.8\.15/);
  assert.ok(!redacted.includes(synthGuid));
  assert.ok(!redacted.includes(synthSnow));
  assert.doesNotMatch(redacted, /vm-avd-p-1/);
  assert.match(redacted, /00000000-0000-0000-0000-000000000000/);
  assert.match(redacted, /<user-upn>/);
  assert.match(redacted, /<ip-redacted>/);
  assert.match(redacted, /<host-1>/);
});

test('buildCmdbIreBatch defaults to pseudonymized identifiers and supports opt-in estate identifiers', () => {
  const pseudoBatch = core.buildCmdbIreBatch(c11, { allowEstateIdentifiers: false });
  assert.equal(pseudoBatch.items.length, 7);
  assert.equal(pseudoBatch.items[0].className, 'cmdb_ci_service_technical');
  assert.equal(pseudoBatch.items[1].values.object_id, '<pool-1>');
  assert.equal(pseudoBatch.items[2].values.object_id, '<host-1>');
  assert.equal(pseudoBatch.items[3].values.drain_mode, true);
  assert.ok(pseudoBatch.relations.length >= 6);

  const realBatch = core.buildCmdbIreBatch(c11, { allowEstateIdentifiers: true });
  assert.equal(realBatch.items[1].values.name, 'vdpool-prod-ncus-001');
  assert.equal(realBatch.items[2].values.name, 'vm-avd-p-0.contoso.com');
});

test('reconcileProblemsFromC21 is idempotent (upsert -> noop -> resolve)', () => {
  const firstRun = core.reconcileProblemsFromC21(c21, []);
  assert.equal(firstRun.length, 2);
  assert.equal(firstRun[0].correlationId, 'avd-ops:c21:contoso-prod:AZ-NET-004');
  assert.equal(firstRun[0].action, 'upsert');
  assert.equal(firstRun[1].correlationId, 'avd-ops:c21:contoso-prod:AZ-STO-002');
  assert.equal(firstRun[1].action, 'upsert');

  // Second run with existing open problems should emit noop (no duplicate ticket flood)
  const secondRun = core.reconcileProblemsFromC21(c21, firstRun);
  assert.equal(secondRun[0].action, 'noop');
  assert.equal(secondRun[1].action, 'noop');

  // If EN-CA-001 was previously open and is now pass in C21, it transitions to resolve
  const withResolved = core.reconcileProblemsFromC21(c21, [
    {
      correlationId: 'avd-ops:c21:contoso-prod:EN-CA-001',
      state: 'open',
      severity: 'high',
      shortDescription: '[AVD Drift] EN-CA-001: Conditional Access MFA policy enforced for AVD cloud app'
    }
  ]);
  const resolvedItem = withResolved.find((p) => p.checkId === 'EN-CA-001');
  assert.ok(resolvedItem);
  assert.equal(resolvedItem.action, 'resolve');
});

test('buildSwarmRunbookTrigger enforces V1-4 alert provenance and detects prompt injection', () => {
  const trigger = core.buildSwarmRunbookTrigger(incident);
  assert.equal(trigger.threadStartedBy, 'alert');
  assert.equal(trigger.runMode, 'read-only');
  assert.equal(trigger.v14WriteRefusedWithoutFreshFacts, true);
  assert.equal(trigger.runbookId, 'storage.fslogix-profile-attach');
  assert.equal(trigger.promptShield.suspected, true);
  assert.ok(trigger.promptShield.matchCount >= 2);
  assert.doesNotMatch(trigger.redactedDescription, /user@contoso\.com/);
  assert.doesNotMatch(trigger.redactedDescription, /10\.24\.8\.15/);
});

test('buildSyncEnvelope produces a valid C26 candidate envelope that passes validateSyncEnvelope', () => {
  const env = core.buildSyncEnvelope({
    estateSlug: 'contoso-prod',
    allowEstateIdentifiers: false,
    c11,
    c21,
    c24
  });
  const validation = core.validateSyncEnvelope(env);
  assert.equal(validation.valid, true, `Validation errors: ${validation.errors.join(', ')}`);
  assert.equal(env.changeRequests.length, 2);
  assert.equal(env.knownErrorDrafts.length, 1);

  // Tamper with envelope to verify validator catches unredacted email in pseudonymized mode
  const badEnv = JSON.parse(JSON.stringify(env));
  badEnv.problems[0].shortDescription = 'Leaked user alice@contoso.com in shortDescription';
  const badValidation = core.validateSyncEnvelope(badEnv);
  assert.equal(badValidation.valid, false);
  assert.match(badValidation.errors.join(' '), /Unredacted email\/UPN/);
});
