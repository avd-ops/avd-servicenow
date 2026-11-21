/* Personal project, not for production, as is; not affiliated with the author's employer, ServiceNow, Liquidware or Microsoft. MIT.
   scripts/ticket-adapter.mjs: Normalized 5-method ticket adapter (ADR 0027) for ServiceNow /api/now/table/incident. */

import { createRequire } from 'node:module';
import { buildAuthHeader, normalizeInstanceUrl, parseSnowJsonResponse } from './pdi-client.mjs';

const require = createRequire(import.meta.url);
const core = require('../site/portal/servicenow-core.js');

const DEFAULT_SNOW_STATE_MAP = {
  new: '1',              // New
  triaging: '2',         // In Progress
  awaiting_approval: '3', // On Hold
  resolved: '6',         // Resolved
};

const REVERSE_SNOW_STATE = {
  '1': 'new',
  '2': 'triaging',
  '3': 'awaiting_approval',
  '6': 'resolved',
};

/**
 * Create a ServiceNow Incident Table API adapter implementing the 5-method contract:
 * createTicket, listOpenTickets, getTicket, addWorkNote, transitionTicket.
 */
export function createServiceNowTicketAdapter(options = {}) {
  const baseUrl = normalizeInstanceUrl(options.baseUrl || process.env.SNOW_INSTANCE_URL);
  const authHeader = options.authHeader || buildAuthHeader(options.env || process.env);
  const stateMap = { ...DEFAULT_SNOW_STATE_MAP, ...(options.stateMap || {}) };
  const fetchImpl = options.fetch || globalThis.fetch;

  async function snowRequest(method, apiPath, bodyObj) {
    const headers = {
      Accept: 'application/json',
      Authorization: authHeader,
    };
    const init = { method, headers };
    if (bodyObj !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(bodyObj);
    }
    const res = await fetchImpl(`${baseUrl}${apiPath}`, init);
    const text = await res.text();
    return parseSnowJsonResponse(res.status, res.headers.get('content-type'), text);
  }

  function toNormalizedTicket(row) {
    return {
      id: row.number || row.sys_id,
      sysId: row.sys_id,
      title: row.short_description || '',
      description: row.description || '',
      status: REVERSE_SNOW_STATE[String(row.state || '1')] || String(row.state || 'new'),
      priority: row.priority || '3',
    };
  }

  async function resolveSysId(id) {
    if (/^[0-9a-f]{32}$/i.test(id)) return id;
    const data = await snowRequest(
      'GET',
      `/api/now/table/incident?sysparm_query=number=${encodeURIComponent(id)}&sysparm_limit=1`
    );
    const row = (data.result || [])[0];
    if (!row) throw new Error(`ServiceNow incident not found: ${id}`);
    return row.sys_id;
  }

  return {
    provider: 'servicenow',

    async createTicket(payload) {
      const data = await snowRequest('POST', '/api/now/table/incident', {
        short_description: core.redactText(payload.title || ''),
        description: core.redactText(payload.description || ''),
        state: stateMap.new,
        category: payload.category || 'avd',
      });
      return toNormalizedTicket(data.result || {});
    },

    async listOpenTickets(filter = {}) {
      const wantState = stateMap[filter.status || 'new'] || stateMap.new;
      const limit = Number(filter.limit || 25);
      const data = await snowRequest(
        'GET',
        `/api/now/table/incident?sysparm_query=state=${encodeURIComponent(wantState)}^ORDERBYsys_created_on&sysparm_limit=${limit}`
      );
      return (data.result || []).map(toNormalizedTicket);
    },

    async getTicket(id) {
      const sysId = await resolveSysId(id);
      const data = await snowRequest('GET', `/api/now/table/incident/${encodeURIComponent(sysId)}`);
      return toNormalizedTicket(data.result || {});
    },

    async addWorkNote(id, body, { internal = true } = {}) {
      const sysId = await resolveSysId(id);
      const safeBody = core.redactText(String(body || ''));
      const field = internal ? { work_notes: safeBody } : { comments: safeBody };
      const data = await snowRequest('PATCH', `/api/now/table/incident/${encodeURIComponent(sysId)}`, field);
      return { id: (data.result || {}).number || id, internal: Boolean(internal) };
    },

    async transitionTicket(id, targetState) {
      const sysId = await resolveSysId(id);
      const nextState = stateMap[targetState] || targetState;
      const data = await snowRequest('PATCH', `/api/now/table/incident/${encodeURIComponent(sysId)}`, {
        state: nextState,
      });
      return toNormalizedTicket(data.result || { sys_id: sysId, state: nextState });
    },
  };
}
