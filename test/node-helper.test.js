/* Checks startup from persistent data, local rollover, save notifications, and errors. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { loadDefinition } = require("./node-helper-stub");
const { PlanStore } = require("../lunch-store");

function helper(t) {
  const messages = [];
  const routes = [];
  const instance = {...loadDefinition(),expressApp:{use:(...args)=>routes.push(args)},sendSocketNotification:(...args)=>messages.push(args)};
  instance.start();
  t.after(() => instance.stop());
  return {instance,messages,routes};
}

test("helper reads disk immediately without a fetch and starts a local rollover timer", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),"lunch-helper-"));
  t.after(() => fs.rm(dir,{recursive:true,force:true}));
  const filename = path.join(dir,"plan.json");
  const store = new PlanStore(filename);
  const plan = await store.load();
  plan.settings.week1Monday = "2026-11-02";
  plan.menu.forEach(row => { row.lunch = "From disk"; });
  await store.save(plan);
  const {instance,messages,routes} = helper(t);
  await instance.socketNotificationReceived("LUNCH_CONFIG",{dataFile:filename});
  assert.equal(routes[0][0],"/lunch");
  assert.equal(typeof instance.handler,"function");
  assert.ok(instance.timer);
  assert.equal(messages[0][0],"LUNCH_DATA");
  assert.equal(instance.store.read().menu[0].lunch,"From disk");
  const timer = instance.timer;
  await instance.socketNotificationReceived("LUNCH_CONFIG",{dataFile:filename});
  assert.equal(instance.timer,timer,"re-registration must not start another timer");
  instance.stop();
  const count = messages.length;
  instance.emit();
  assert.equal(messages.length,count);
});

test("load failure becomes a visible error, and corrupt household data is retained", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),"lunch-helper-bad-"));
  t.after(() => fs.rm(dir,{recursive:true,force:true}));
  const filename = path.join(dir,"plan.json");
  await fs.writeFile(filename,"invalid");
  const {instance,messages} = helper(t);
  await instance.socketNotificationReceived("LUNCH_CONFIG",{dataFile:filename});
  assert.equal(messages.at(-1)[1].status,"error");
  assert.equal(instance.handler,null);
  assert.equal(await fs.readFile(filename,"utf8"),"invalid");
});
