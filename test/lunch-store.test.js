/* Verifies disk persistence, conflict protection, backup, and failed-save recovery. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { PlanStore, atomicWrite } = require("../lunch-store");

async function location(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),"lunch-test-"));
  t.after(() => fs.rm(dir,{recursive:true,force:true}));
  return path.join(dir,"persistent","plan.json");
}

test("save survives a fresh store and keeps a previous valid backup", async t => {
  const filename = await location(t);
  const store = new PlanStore(filename);
  const initial = await store.load();
  assert.equal(initial.revision,0);
  initial.menu[0].lunch = "Pasta\nPeas";
  const first = await store.save(initial);
  const other = structuredClone(first);
  other.menu[0].lunch = "Rice";
  const second = await store.save(other);
  assert.equal(second.revision,2);
  const restarted = new PlanStore(filename);
  assert.deepEqual(await restarted.load(),second);
  assert.deepEqual(JSON.parse(await fs.readFile(`${filename}.bak`,"utf8")),first);
  assert.equal((await fs.stat(filename)).mode & 0o777,0o600);
  assert.deepEqual((await fs.readdir(path.dirname(filename))).sort(),["plan.json","plan.json.bak"]);
});

test("simultaneous stale edits do not overwrite a successful save", async t => {
  const store = new PlanStore(await location(t));
  const base = await store.load();
  const results = await Promise.allSettled([store.save(base),store.save(base)]);
  assert.equal(results[0].status,"fulfilled");
  assert.equal(results[1].status,"rejected");
  assert.equal(results[1].reason.status,409);
  const next = store.read();
  assert.equal((await store.save(next)).revision,2);
});

test("a failed write preserves the current plan and the save queue remains usable", async t => {
  let fail = false;
  const store = new PlanStore(await location(t),{write:async (...args) => {
    if (fail) throw new Error("Disk full");
    return atomicWrite(...args);
  }});
  const base = await store.load();
  const first = await store.save(base);
  fail = true;
  const draft = structuredClone(first);
  draft.menu[0].lunch = "Unsaved";
  await assert.rejects(store.save(draft),/Disk full/);
  assert.deepEqual(store.read(),first);
  fail = false;
  assert.equal((await store.save(draft)).menu[0].lunch,"Unsaved");
});

test("a corrupt existing file is not replaced with an empty plan", async t => {
  const filename = await location(t);
  await fs.mkdir(path.dirname(filename),{recursive:true});
  await fs.writeFile(filename,"broken data");
  await assert.rejects(new PlanStore(filename).load());
  assert.equal(await fs.readFile(filename,"utf8"),"broken data");
});
