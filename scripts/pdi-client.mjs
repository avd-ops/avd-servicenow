#!/usr/bin/env node
/* Personal project, not for production, as is; not affiliated with the author's employer, ServiceNow, Liquidware or Microsoft. MIT.
   scripts/pdi-client.mjs: REST client for ServiceNow Personal Developer Instances (PDI) and the local Mock-PDI server.
   Reads credentials strictly from environment variables (SNOW_INSTANCE_URL, SNOW_OAUTH_TOKEN or SNOW_USERNAME/SNOW_PASSWORD). */

import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../site/portal/servicenow-core.js');

export function normalizeInstanceUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    throw new Error('SNOW_INSTANCE_URL is required for PDI sync.');
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid SNOW_INSTANCE_URL format; expected https://<instance>.service-now.com');
  }
  const isLocalMock =
    parsed.protocol === 'http:' &&
    (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
  if (parsed.protocol !== 'https:' && !isLocalMock) {
    throw new Error('SNOW_INSTANCE_URL must use https:// (or http://127.0.0.1 for local MockPdi).');
  }
  // Strip any pasted browser redirect path such as /login_redirect.do?sysparm_stack=no
  return parsed.origin;
}

export function buildAuthHeader(env = process.env) {
  if (env.SNOW_OAUTH_TOKEN) {
    return 'Bearer ' + String(env.SNOW_OAUTH_TOKEN).trim();
  }
  if (env.SNOW_USERNAME && env.SNOW_PASSWORD) {
    const token = Buffer.from(`${env.SNOW_USERNAME}:${env.SNOW_PASSWORD}`, 'utf8').toString('base64');
    return 'Basic ' + token;
  }
  throw new Error(
    'Missing ServiceNow credentials in environment. Set SNOW_OAUTH_TOKEN (preferred OIDC/OAuth) or SNOW_USERNAME and SNOW_PASSWORD in your local shell.'
  );
}

export function parseSnowJsonResponse(status, contentType, bodyText) {
  const ct = String(contentType || '').toLowerCase();
  if (!ct.includes('application/json')) {
    if (/hibernat|wake|login_redirect|sign\s*in/i.test(String(bodyText || ''))) {
      throw new Error(
        'PDI_HIBERNATING_OR_AUTH_REDIRECT: ServiceNow returned HTML instead of JSON (red-team M2). Wake the PDI at developer.servicenow.com or verify credentials.'
      );
    }
    throw new Error(`Expected application/json from ServiceNow REST API (HTTP ${status}), got: ${ct || 'unknown'}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch (err) {
    throw new Error(`Invalid JSON from ServiceNow REST API (HTTP ${status}): ${err.message}`);
  }
  if (status < 200 || status >= 300) {
    const msg = parsed?.error?.message || `HTTP ${status}`;
    throw new Error(`ServiceNow API error: ${core.redactText(msg)}`);
  }
  return parsed;
}

async function snowRequest(baseUrl, authHeader, method, apiPath, bodyObj, fetchImpl = globalThis.fetch) {
  const url = `${baseUrl}${apiPath}`;
  const headers = {
    Accept: 'application/json',
    Authorization: authHeader
  };
  const init = { method, headers };
  if (bodyObj !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(bodyObj);
  }
  const res = await fetchImpl(url, init);
  const text = await res.text();
  return parseSnowJsonResponse(res.status, res.headers.get('content-type'), text);
}

export async function pushSyncEnvelopeToPdi(envelope, options = {}) {
  const validation = core.validateSyncEnvelope(envelope);
  if (!validation.valid) {
    throw new Error(`Refusing to push invalid or unredacted envelope: ${validation.errors.join('; ')}`);
  }

  const baseUrl = normalizeInstanceUrl(options.instanceUrl || process.env.SNOW_INSTANCE_URL);
  const authHeader = options.authHeader || buildAuthHeader(options.env || process.env);
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  // 1. Push CMDB IRE batch
  const ireRes = await snowRequest(
    baseUrl,
    authHeader,
    'POST',
    '/api/now/identifyreconcile?sysparm_data_source=avd-ops',
    envelope.cmdbIreBatch,
    fetchImpl
  );
  const ireItems = ireRes?.result?.items || [];

  // 2. Query existing Problems for this estate to reconcile idempotently (SN5 / H1)
  const prefix = `avd-ops:c21:${envelope.estateSlug}:`;
  const existingProbRes = await snowRequest(
    baseUrl,
    authHeader,
    'GET',
    `/api/now/table/problem?sysparm_query=${encodeURIComponent(`correlation_idSTARTSWITH${prefix}`)}&sysparm_fields=sys_id,correlation_id,short_description,state`,
    undefined,
    fetchImpl
  );
  const existingRows = Array.isArray(existingProbRes?.result) ? existingProbRes.result : [];
  const byCorrelation = new Map();
  for (const row of existingRows) {
    if (row.correlation_id) {
      byCorrelation.set(row.correlation_id, row);
    }
  }

  let problemsCreated = 0;
  let problemsUpdated = 0;
  let problemsResolved = 0;
  let problemsNoop = 0;

  for (const prob of envelope.problems) {
    const existing = byCorrelation.get(prob.correlationId);
    if (prob.action === 'noop') {
      problemsNoop++;
      continue;
    }
    if (prob.action === 'resolve') {
      if (existing && existing.sys_id && String(existing.state) !== 'resolved') {
        await snowRequest(
          baseUrl,
          authHeader,
          'PATCH',
          `/api/now/table/problem/${existing.sys_id}`,
          {
            state: 'resolved',
            resolution_notes: `Resolved automatically: check ${prob.checkId} passed in C21 snapshot ${envelope.sourceContracts.c21Sha256}.`
          },
          fetchImpl
        );
        problemsResolved++;
      } else {
        problemsNoop++;
      }
      continue;
    }

    // upsert
    if (!existing) {
      await snowRequest(
        baseUrl,
        authHeader,
        'POST',
        '/api/now/table/problem',
        {
          correlation_id: prob.correlationId,
          short_description: prob.shortDescription,
          cmdb_ci: prob.affectedCiId,
          work_notes: `Citations: ${(prob.citations || []).join(', ')}`
        },
        fetchImpl
      );
      problemsCreated++;
    } else if (existing.short_description !== prob.shortDescription) {
      await snowRequest(
        baseUrl,
        authHeader,
        'PATCH',
        `/api/now/table/problem/${existing.sys_id}`,
        {
          short_description: prob.shortDescription,
          work_notes: `Updated drift state from C21 snapshot ${envelope.sourceContracts.c21Sha256}.`
        },
        fetchImpl
      );
      problemsUpdated++;
    } else {
      problemsNoop++;
    }
  }

  // 3. Upsert Change Requests from C24 waves
  const chgPrefix = `avd-ops:c24:${envelope.estateSlug}:`;
  const existingChgRes = await snowRequest(
    baseUrl,
    authHeader,
    'GET',
    `/api/now/table/change_request?sysparm_query=${encodeURIComponent(`correlation_idSTARTSWITH${chgPrefix}`)}&sysparm_fields=sys_id,correlation_id`,
    undefined,
    fetchImpl
  );
  const existingChgs = new Map();
  for (const row of Array.isArray(existingChgRes?.result) ? existingChgRes.result : []) {
    if (row.correlation_id) existingChgs.set(row.correlation_id, row);
  }

  let changesCreated = 0;
  let changesNoop = 0;
  for (const chg of envelope.changeRequests) {
    if (existingChgs.has(chg.correlationId)) {
      changesNoop++;
      continue;
    }
    await snowRequest(
      baseUrl,
      authHeader,
      'POST',
      '/api/now/table/change_request',
      {
        correlation_id: chg.correlationId,
        type: chg.type,
        short_description: chg.shortDescription,
        implementation_plan: chg.implementationPlan,
        backout_plan: chg.backoutPlan,
        test_plan: chg.testPlan
      },
      fetchImpl
    );
    changesCreated++;
  }

  return {
    schema: 'avd-servicenow-pdi-sync-result/v1',
    estateSlug: envelope.estateSlug,
    redactionLevel: envelope.redactionLevel,
    cmdbItemsReconciled: ireItems.length || envelope.cmdbIreBatch.items.length,
    problems: {
      created: problemsCreated,
      updated: problemsUpdated,
      resolved: problemsResolved,
      noop: problemsNoop
    },
    changeRequests: {
      created: changesCreated,
      noop: changesNoop
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const envelopePath = process.argv[2];
  if (!envelopePath) {
    console.error('Usage: node scripts/pdi-client.mjs <path-to-envelope.json>');
    process.exit(1);
  }
  const envelope = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
  pushSyncEnvelopeToPdi(envelope)
    .then((summary) => {
      process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
