// Run separately with Node 24+: node --test tests/sqlite-integration.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import worker from '../worker/index.js';

// Real SQLite with the small D1 statement surface used by this application.
// This catches SQL/binding/schema errors; it is not a Cloudflare runtime emulator.
class LocalD1 {
  constructor(path) { this.sqlite = new DatabaseSync(path); this.sqlite.exec('PRAGMA foreign_keys = ON'); }
  prepare(sql) {
    const statement = this.sqlite.prepare(sql);
    return { bind(...values) { return {
      async first() { return statement.get(...values) ?? null; },
      async all() { return { results: statement.all(...values) }; },
      async run() { return { meta: { changes: Number(statement.run(...values).changes) } }; },
      async execute() { return statement.columns().length ? this.all() : this.run(); },
    }; } };
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.execute()); this.sqlite.exec('COMMIT'); return results; }
    catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
  close() { this.sqlite.close(); }
}
async function call(db, path, method = 'GET', body, owner = 'alice') {
  const headers = { 'oai-authenticated-user-id': owner, Origin: 'https://crm.example.test' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await worker.fetch(new Request('https://crm.example.test' + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { DB: db });
  return { status: response.status, ...(await response.json()) };
}

test('real SQLite: CRUD, isolation, restart persistence and archive cascade', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'affiliate-crm-test-'));
  const path = join(directory, 'test.sqlite');
  let db = new LocalD1(path);
  try {
    db.sqlite.exec(readFileSync(new URL('../drizzle/0000_affiliate_crm.sql', import.meta.url), 'utf8'));
    const created = await call(db, '/api/leads', 'POST', { name: 'Test lead', commission: 123.45, cards: [{ bank: 'Test bank', status: 'planned' }], dueAt: '2026-10-29T15:00:00+03:00' });
    assert.equal(created.status, 201); const id = created.data.id;
    assert.equal(created.data.commission, 123.45);
    assert.equal(created.data.dueAt, '2026-10-29T12:00:00.000Z');
    assert.equal((await call(db, `/api/leads/${id}`, 'PATCH', { stage: 'contacted' })).data.stage, 'contacted');
    assert.equal((await call(db, `/api/leads/${id}/notes`, 'POST', { body: 'Call tomorrow' })).status, 201);
    const task = await call(db, '/api/tasks', 'POST', { leadId: id, title: 'Call' });
    assert.equal(task.status, 201);
    assert.equal((await call(db, `/api/tasks/${task.data.id}`, 'PATCH', { done: true })).data.done, true);
    for (const [endpoint, method, body] of [
      [`/api/leads/${id}`, 'GET'], [`/api/leads/${id}`, 'PATCH', { name: 'Stolen' }],
      [`/api/leads/${id}`, 'DELETE'], [`/api/leads/${id}/notes`, 'POST', { body: 'Stolen' }],
      ['/api/tasks', 'POST', { leadId: id, title: 'Stolen' }],
      [`/api/tasks/${task.data.id}`, 'PATCH', { done: false }],
    ]) assert.equal((await call(db, endpoint, method, body, 'bob')).status, 404);
    const foreign = await call(db, '/api/state', 'GET', undefined, 'bob');
    assert.deepEqual(foreign.data.leads, []); assert.deepEqual(foreign.data.tasks, []);
    db.close(); db = new LocalD1(path);
    const state = await call(db, '/api/state');
    assert.equal(state.status, 200); assert.equal(state.data.leads[0].noteHistory[0].body, 'Call tomorrow');
    assert.equal(state.data.tasks[0].done, true); assert.equal(state.data.integration.telegramConnected, false);
    assert.equal((await call(db, `/api/leads/${id}`, 'DELETE')).status, 200);
    assert.equal((await call(db, `/api/leads/${id}`)).status, 404);
    const archived = await call(db, '/api/state');
    assert.deepEqual(archived.data.leads, []); assert.deepEqual(archived.data.tasks, []);
    assert.equal((await call(db, `/api/leads/${id}/notes`, 'POST', { body: 'Late note' })).status, 404);
    assert.equal((await call(db, '/api/tasks', 'POST', { leadId: id, title: 'Late task' })).status, 404);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM crm_leads').get().count, 1);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM crm_notes').get().count, 1);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});
