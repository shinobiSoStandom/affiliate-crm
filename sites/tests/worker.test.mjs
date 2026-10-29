import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";

test("API rejects missing Sites identity before accessing storage", async () => {
  const response = await worker.fetch(new Request("https://crm.example/api/state"), {});
  assert.equal(response.status, 401);
});

test("cross-origin mutation is rejected before accessing storage", async () => {
  const response = await worker.fetch(new Request("https://crm.example/api/leads", {
    method: "POST",
    headers: { "oai-authenticated-user-id": "test-user", Origin: "https://other.example", "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Test" }),
  }), {});
  assert.equal(response.status, 403);
});

test("missing D1 binding is explicit and does not use ephemeral storage", async () => {
  const response = await worker.fetch(new Request("https://crm.example/api/state", {
    headers: { "oai-authenticated-user-id": "test-user" },
  }), {});
  assert.equal(response.status, 503);
});

test("HTML is private-cache-safe and uses a fresh CSP nonce", async () => {
  const first = await worker.fetch(new Request("https://crm.example/"), {});
  const second = await worker.fetch(new Request("https://crm.example/"), {});
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("Cache-Control"), "no-store");
  assert.equal(first.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.notEqual(first.headers.get("Content-Security-Policy"), second.headers.get("Content-Security-Policy"));
  assert.match(await first.text(), /<script nonce="/);
});

test("HTML routes reject write methods", async () => {
  const response = await worker.fetch(new Request("https://crm.example/", { method: "POST" }), {});
  assert.equal(response.status, 405);
});
