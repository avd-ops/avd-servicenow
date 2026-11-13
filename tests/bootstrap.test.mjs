import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  'README.md',
  'LICENSE',
  'PINS.json',
  'docs/spec.md',
  'docs/guardrails.md',
  'docs/decisions/ASN-0001-servicenow-tier.md',
  'schemas/avd-itsm-sync-envelope.v1.schema.json',
  'adapters/servicenow/adapter.yml',
  '.github/workflows/ci.yml'
];

test('Phase 0 bootstrap files exist and are non-empty', () => {
  for (const rel of REQUIRED_FILES) {
    const full = path.join(ROOT, rel);
    assert.ok(fs.existsSync(full), `Missing required file: ${rel}`);
    const stat = fs.statSync(full);
    assert.ok(stat.size > 0, `File is empty: ${rel}`);
  }
});

test('Disclaimers and partner notices are present in entry points', () => {
  for (const rel of ['AGENTS.md', 'CLAUDE.md', 'README.md', 'docs/spec.md']) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(text, /Personal project/i, `${rel} must include personal project notice`);
    assert.match(text, /ServiceNow/i, `${rel} must mention ServiceNow in notice`);
    assert.match(text, /Liquidware/i, `${rel} must mention Liquidware in notice`);
    assert.match(text, /Microsoft/i, `${rel} must mention Microsoft in notice`);
  }
});

test('PINS.json pins upstream avd-ops repositories by 40-char commit SHA', () => {
  const pins = JSON.parse(fs.readFileSync(path.join(ROOT, 'PINS.json'), 'utf8'));
  assert.equal(pins.schema, 'avd-pins/v1');
  for (const repo of ['avd-assess', 'avd-current-state', 'avd-second-brain', 'avd-swarm']) {
    assert.ok(pins.upstreams[repo], `Missing upstream pin for ${repo}`);
    assert.match(pins.upstreams[repo].commit, /^[0-9a-f]{40}$/, `Invalid SHA for ${repo}`);
  }
});

test('avd-itsm-sync-envelope.v1.schema.json is valid JSON Schema', () => {
  const schema = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'schemas/avd-itsm-sync-envelope.v1.schema.json'), 'utf8')
  );
  assert.equal(schema.properties.schema.const, 'avd-itsm-sync-envelope/v1');
  assert.deepEqual(schema.properties.redactionLevel.enum, [
    'pseudonymized',
    'estate-identifiers-opt-in'
  ]);
  assert.ok(schema.required.includes('cmdbIreBatch'));
  assert.ok(schema.required.includes('problems'));
  assert.ok(schema.required.includes('changeRequests'));
  assert.ok(schema.required.includes('knownErrorDrafts'));
});

test('adapters/servicenow/adapter.yml satisfies avd-swarm WP5 adapter invariants', () => {
  const yml = fs.readFileSync(path.join(ROOT, 'adapters/servicenow/adapter.yml'), 'utf8');
  assert.match(yml, /^name:\s*servicenow$/m);
  assert.match(yml, /^kind:\s*incident$/m);
  assert.match(yml, /^default:\s*off$/m);
  assert.match(yml, /^replaces:\s*\[\]$/m);
  assert.match(yml, /^writes:\s*none$/m);
  assert.match(yml, /^exitTests:\s*\[\]$/m);
});

test('Repository contains no leaked GUIDs, real ServiceNow instances, or private sibling repo names', () => {
  function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else out.push(full);
    }
    return out;
  }

  const uuidRegex = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
  const snowHostRegex = /\b([a-z0-9-]+)\.service-now\.com\b/gi;
  const bannedPrivateSiblings = /\b(avd-remediate|avd-sandbox|avd-cleanbench|tenant-swarm|avd-readiness-ux)\b/i;

  for (const file of walk(ROOT)) {
    const rel = path.relative(ROOT, file);
    if (rel === 'tests/bootstrap.test.mjs' || rel.endsWith('.woff2')) continue;
    const text = fs.readFileSync(file, 'utf8');

    const uuids = text.match(uuidRegex) || [];
    for (const u of uuids) {
      assert.equal(
        u,
        '00000000-0000-0000-0000-000000000000',
        `Unredacted UUID found in ${rel}: ${u}`
      );
    }

    for (const match of text.matchAll(snowHostRegex)) {
      assert.equal(
        match[1].toLowerCase(),
        'contoso',
        `Non-contoso ServiceNow instance found in ${rel}: ${match[0]}`
      );
    }

    assert.doesNotMatch(
      text,
      bannedPrivateSiblings,
      `Public-ready file ${rel} must not name private sibling repositories`
    );
  }
});
