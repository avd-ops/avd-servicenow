import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const core = require('../site/portal/servicenow-core.js');

test('portal HTML follows avd-ops portal rules: shell portal class, notice before first h2, no inline styles/scripts, credit line, strict ASCII', () => {
  const html = read('site/portal/index.html');
  assert.match(html, /<body class="shell portal">/);
  const beforeH2 = html.split('<h2')[0];
  for (const re of [
    /Personal project\. Research and learning only\. Not for production\. No warranty\./,
    /Not affiliated with, endorsed by or supported by my employer, ServiceNow, Liquidware or Microsoft\./,
    /Don't run any of it in production\./,
    /"as is", without warranty of any kind/,
    /Contributions and forks are welcome and encouraged\./
  ]) {
    assert.match(beforeH2, re, `portal notice before first <h2> missing ${re}`);
  }
  assert.doesNotMatch(html, /<style|\sstyle="|\son[a-z]+\s*=/i, 'no inline styles or event handlers');
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/, 'no inline script blocks');
  assert.match(html, /<p class="credit">A <a href="https:\/\/prignano\.ai\/">prignano\.ai<\/a> production<\/p>/);

  for (const f of ['site/portal/index.html', 'site/portal/portal.css', 'site/portal/servicenow-core.js', 'site/portal/portal.js']) {
    const content = read(f);
    assert.doesNotMatch(content, /[^\x00-\x7e]/, `${f} must stay strictly ASCII`);
  }

  for (const f of ['site/portal/servicenow-core.js', 'site/portal/portal.js']) {
    assert.doesNotMatch(
      read(f),
      /\beval\s*\(|new Function|innerHTML|outerHTML|insertAdjacentHTML|document\.write/,
      `${f} uses unsafe DOM APIs`
    );
  }
});

test('vendored design system in site/assets/ matches MANIFEST.json hashes and portal.css uses only design-system tokens', () => {
  const manifest = JSON.parse(read('site/assets/MANIFEST.json'));
  const baseCss = read('site/assets/avd-ops.css');
  assert.match(baseCss, new RegExp(`^/\\* avd-ops design system v${manifest.version.replace(/\./g, '\\.')} `));

  for (const [relPath, expectedSha] of Object.entries(manifest.files)) {
    const full = join(ROOT, 'site/assets', relPath);
    assert.ok(existsSync(full), `missing vendored asset ${relPath}`);
    const actualSha = createHash('sha256').update(readFileSync(full)).digest('hex');
    assert.equal(actualSha, expectedSha, `${relPath} hash mismatch`);
  }

  const portalCss = read('site/portal/portal.css');
  assert.doesNotMatch(portalCss, /#[0-9a-fA-F]{3,6}\b|rgba?\(|:root|@font-face/, 'portal.css must use design system tokens only');
  const definedTokens = new Set([...baseCss.matchAll(/(--[\w-]+):/g)].map((m) => m[1]));
  for (const [, token] of portalCss.matchAll(/var\((--[\w-]+)/g)) {
    assert.ok(definedTokens.has(token), `${token} is not defined in avd-ops.css`);
  }

  const html = read('site/portal/index.html');
  for (const [, href] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|#|\.\/$)/.test(href)) continue;
    const target = join(ROOT, dirname('site/portal/index.html'), href.split('#')[0]);
    assert.ok(existsSync(target), `unresolved relative link ${href}`);
  }
});

test('every command block in HTML and servicenow-core.js stands alone in Cloud Shell (lesson 0015)', () => {
  const html = read('site/portal/index.html');
  for (const [, block] of html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)) {
    assert.match(block, /git clone https:\/\/github\.com\/nickprignano\/avd-servicenow\.git/);
    assert.match(block, /Set-Location ~\/avd-servicenow; git checkout -q \w+; git pull -q --ff-only/);
  }

  const pwshCmd = core.buildCommandBlock({ shell: 'pwsh', estateSlug: 'contoso-prod', mode: 'OfflineFixture' });
  assert.match(pwshCmd, /Invoke-AvdServiceNowSync\.ps1 -EstateSlug contoso-prod -Mode OfflineFixture/);

  const bashCmd = core.buildCommandBlock({ shell: 'bash', estateSlug: 'contoso-prod', mode: 'WhatIf' });
  assert.match(bashCmd, /Invoke-AvdServiceNowSync\.ps1 -EstateSlug contoso-prod -Mode WhatIf/);
});
