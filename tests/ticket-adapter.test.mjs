import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServiceNowTicketAdapter } from '../scripts/ticket-adapter.mjs';

test('createServiceNowTicketAdapter implements 5-method lifecycle against /api/now/table/incident', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

    if (url.endsWith('/api/now/table/incident') && init.method === 'POST') {
      return json({ result: { sys_id: '00000000000000000000000000000001', number: 'INC0010001', short_description: calls.at(-1).body.short_description, state: '1' } }, 201);
    }
    if (url.includes('sysparm_query=state=1')) {
      return json({ result: [{ sys_id: '00000000000000000000000000000001', number: 'INC0010001', short_description: 'FSLogix temp profile', state: '1' }] });
    }
    if (url.includes('sysparm_query=number=INC0010001')) {
      return json({ result: [{ sys_id: '00000000000000000000000000000001', number: 'INC0010001' }] });
    }
    if (url.endsWith('/api/now/table/incident/00000000000000000000000000000001') && init.method === 'GET') {
      return json({ result: { sys_id: '00000000000000000000000000000001', number: 'INC0010001', short_description: 'FSLogix temp profile', state: '1' } });
    }
    if (url.endsWith('/api/now/table/incident/00000000000000000000000000000001') && init.method === 'PATCH') {
      return json({ result: { sys_id: '00000000000000000000000000000001', number: 'INC0010001', state: calls.at(-1).body.state || '2' } });
    }
    throw new Error(`Unexpected URL: ${init.method} ${url}`);
  };

  const adapter = createServiceNowTicketAdapter({
    baseUrl: 'https://contoso.service-now.com',
    env: { SNOW_OAUTH_TOKEN: 'test-token' },
    fetch: fakeFetch,
  });

  const created = await adapter.createTicket({ title: 'FSLogix temp profile for user@contoso.com', description: 'Event ID 26' });
  assert.equal(created.id, 'INC0010001');
  assert.doesNotMatch(created.title, /user@contoso\.com/);

  const open = await adapter.listOpenTickets({ status: 'new' });
  assert.equal(open.length, 1);

  const got = await adapter.getTicket('INC0010001');
  assert.equal(got.id, 'INC0010001');

  const note = await adapter.addWorkNote('INC0010001', 'Redacted triage summary', { internal: true });
  assert.equal(note.internal, true);
  assert.ok(calls.some((c) => c.method === 'PATCH' && c.body.work_notes === 'Redacted triage summary'));

  const moved = await adapter.transitionTicket('INC0010001', 'resolved');
  assert.equal(moved.status, 'resolved');
});
