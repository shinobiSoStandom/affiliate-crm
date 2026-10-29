import test from "node:test";
import assert from "node:assert/strict";
import { handleApi } from "../worker/api.js";

const user = { id: "alice", email: "alice@example.test", name: "Алиса" };
const stamp = "2026-10-29T12:00:00.000Z";
function lead(id, owner, archived = false) {
  return { id, owner_id: owner, name: id, telegram: "", phone: "", stage: "new",
    cards_json: "[]", next_action: "", due_at: null, commission_kopecks: 0, notes: "",
    created_at: stamp, updated_at: stamp, archived_at: archived ? stamp : null };
}
class ScopeProbe {
  constructor() {
    this.leads = [lead("own", "alice"), lead("foreign", "bob"), lead("archived", "alice", true)];
    this.tasks = [{ id: "foreign-task", owner_id: "bob", lead_id: "foreign", archived_at: null }];
    this.queries = [];
    this.writes = 0;
  }
  prepare(sql) {
    const db = this;
    return { bind(...values) {
      db.queries.push({ sql, values });
      return {
        async first() {
          const source = sql.includes("FROM crm_tasks") ? db.tasks : db.leads;
          assert.match(sql, /owner_id = \?/);
          assert.match(sql, /archived_at IS NULL/);
          return source.find((row) => row.id === values[0] && row.owner_id === values[1] && !row.archived_at) || null;
        },
        async all() {
          assert.match(sql, /owner_id = \?/);
          if (sql.includes("FROM crm_notes")) return { results: [] };
          const source = sql.includes("FROM crm_tasks") ? db.tasks : db.leads;
          return { results: source.filter((row) => row.owner_id === values[0] && !row.archived_at) };
        },
        async run() {
          if (sql.startsWith("INSERT INTO crm_tasks") && sql.includes("WHERE EXISTS")) {
            const [leadId, ownerId] = values.slice(-2);
            const exists = db.leads.some((row) => row.id === leadId && row.owner_id === ownerId && !row.archived_at);
            if (!exists) return { meta: { changes: 0 } };
          }
          throw new Error("Unexpected write in isolation test");
        },
      };
    } };
  }
  async batch(statements) { return Promise.all(statements.map((item) => item.all())); }
}
function request(path, method = "GET", body) {
  return new Request("https://crm.example.test" + path, {
    method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}
async function call(db, path, method = "GET", body, identity = user) {
  return handleApi(request(path, method, body), { DB: db }, identity);
}

test("state never exposes another owner's records or archived leads", async () => {
  const db = new ScopeProbe();
  const response = await call(db, "/api/state");
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.deepEqual(data.leads.map((item) => item.id), ["own"]);
  assert.deepEqual(data.tasks, []);
  assert.equal(data.integration.telegramConnected, false);
  assert.equal(data.user.email, user.email);
  assert.ok(db.queries.every(({ sql }) => sql.includes("owner_id")));
});

test("foreign lead and notes are indistinguishable from missing records", async () => {
  for (const [path, method, body] of [
    ["/api/leads/foreign", "GET"],
    ["/api/leads/foreign", "PATCH", { name: "stolen" }],
    ["/api/leads/foreign", "DELETE"],
    ["/api/leads/foreign/notes", "GET"],
  ]) {
    const db = new ScopeProbe();
    const response = await call(db, path, method, body);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "not_found");
    assert.equal(db.writes, 0);
  }
});

test("tasks cannot be linked to a foreign or archived lead", async () => {
  for (const leadId of ["foreign", "archived"]) {
    const response = await call(new ScopeProbe(), "/api/tasks", "POST", { title: "Call", leadId });
    assert.equal(response.status, 404);
  }
  const response = await call(new ScopeProbe(), "/api/tasks/foreign-task", "PATCH", { done: true });
  assert.equal(response.status, 404);
});

test("rejects forged fields, malformed money, stages, cards and dates before writing", async () => {
  for (const body of [
    { name: "Lead", owner_id: "bob" },
    { name: "Lead", commission: -1 },
    { name: "Lead", commission: "500" },
    { name: "Lead", stage: "invented" },
    { name: "Lead", cards: [{ bank: "" }] },
    { name: "Lead", dueAt: "2026-02-30T09:00:00Z" },
    { name: "Lead", dueAt: "2026-10-29T09:00" },
    { name: "x".repeat(161) },
  ]) {
    const db = new ScopeProbe();
    const response = await call(db, "/api/leads", "POST", body);
    assert.equal(response.status, 422);
    assert.equal(db.queries.length, 0);
  }
  const task = await call(new ScopeProbe(), "/api/tasks", "POST", { title: "Call", done: "false" });
  assert.equal(task.status, 422);
});

test("requires identity and a bounded JSON object", async () => {
  const db = new ScopeProbe();
  assert.equal((await call(db, "/api/state", "GET", undefined, null)).status, 401);
  assert.equal((await handleApi(request("/api/state"), {}, user)).status, 503);
  assert.equal((await call(db, "/api/leads", "POST", { name: "x".repeat(70000) })).status, 413);
  const arrayResponse = await handleApi(request("/api/leads", "POST", []), { DB: db }, user);
  assert.equal(arrayResponse.status, 400);
  const wrongType = new Request("https://crm.example.test/api/leads", { method: "POST", body: "x" });
  assert.equal((await handleApi(wrongType, { DB: db }, user)).status, 415);
});

test("unknown routes return null and unsupported methods return 405", async () => {
  const db = new ScopeProbe();
  assert.equal(await call(db, "/api/unknown"), null);
  assert.equal((await call(db, "/api/leads", "PUT", { name: "x" })).status, 405);
  assert.equal((await call(db, "/api/leads/%2e%2e%2Fforeign")).status, 400);
});
