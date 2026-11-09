/* Personal project, not for production, as is; not affiliated with the author's employer, ServiceNow, Liquidware or Microsoft. MIT.
   scripts/mock-pdi-server.mjs: local in-memory mock of ServiceNow IRE, Problem, and Change REST APIs for $0 offline CI testing. */

import http from 'node:http';

export function createMockPdiServer() {
  const state = {
    hibernating: false,
    cmdbItems: new Map(),
    problems: new Map(),
    changeRequests: new Map(),
    seq: 1000
  };

  function nextSysId() {
    state.seq += 1;
    return `mock-sys-id-${state.seq}`;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (url.pathname === '/__hibernate' && req.method === 'POST') {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      state.hibernating = Boolean(body.hibernating);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ hibernating: state.hibernating }));
      return;
    }

    if (state.hibernating) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h1>Your Personal Developer Instance is hibernating</h1><p>Wake instance at developer.servicenow.com</p></body></html>');
      return;
    }

    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ') && !auth.startsWith('Basic ')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'User Not Authenticated' } }));
      return;
    }

    // 1. CMDB IRE endpoint
    if (url.pathname === '/api/now/identifyreconcile' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const items = Array.isArray(body.items) ? body.items : [];
      const outItems = [];
      for (const item of items) {
        const key = `${item.className}:${item.values?.object_id}`;
        const existing = state.cmdbItems.get(key);
        const sysId = existing ? existing.sys_id : nextSysId();
        const operation = existing ? 'UPDATE' : 'INSERT';
        state.cmdbItems.set(key, { sys_id: sysId, className: item.className, values: item.values });
        outItems.push({ className: item.className, operation, sysId });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: { items: outItems } }));
      return;
    }

    // 2. Problem table endpoint
    if (url.pathname === '/api/now/table/problem' && req.method === 'GET') {
      const query = url.searchParams.get('sysparm_query') || '';
      const prefixMatch = query.match(/correlation_idSTARTSWITH(.+)$/);
      const prefix = prefixMatch ? prefixMatch[1] : '';
      const result = [...state.problems.values()].filter((p) =>
        prefix ? String(p.correlation_id || '').startsWith(prefix) : true
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result }));
      return;
    }

    if (url.pathname === '/api/now/table/problem' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const sysId = nextSysId();
      const record = {
        sys_id: sysId,
        correlation_id: body.correlation_id,
        short_description: body.short_description,
        cmdb_ci: body.cmdb_ci,
        state: body.state || 'open',
        work_notes: body.work_notes || ''
      };
      state.problems.set(sysId, record);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: record }));
      return;
    }

    if (url.pathname.startsWith('/api/now/table/problem/') && req.method === 'PATCH') {
      const sysId = url.pathname.split('/').pop();
      const existing = state.problems.get(sysId);
      if (!existing) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Record not found' } }));
        return;
      }
      const body = JSON.parse((await readBody(req)) || '{}');
      Object.assign(existing, body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: existing }));
      return;
    }

    // 3. Change Request table endpoint
    if (url.pathname === '/api/now/table/change_request' && req.method === 'GET') {
      const query = url.searchParams.get('sysparm_query') || '';
      const prefixMatch = query.match(/correlation_idSTARTSWITH(.+)$/);
      const prefix = prefixMatch ? prefixMatch[1] : '';
      const result = [...state.changeRequests.values()].filter((c) =>
        prefix ? String(c.correlation_id || '').startsWith(prefix) : true
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result }));
      return;
    }

    if (url.pathname === '/api/now/table/change_request' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const sysId = nextSysId();
      const record = {
        sys_id: sysId,
        correlation_id: body.correlation_id,
        type: body.type || 'standard',
        short_description: body.short_description,
        state: 'new'
      };
      state.changeRequests.set(sysId, record);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: record }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Endpoint not found' } }));
  });

  return { server, state };
}
