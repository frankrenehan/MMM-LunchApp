/* Exercises real HTTP editor saves, origin checks, conflict handling, and export. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { PlanStore } = require("../lunch-store");
const { createHandler } = require("../lunch-http");

async function server(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),"lunch-http-"));
  const store = new PlanStore(path.join(dir,"plan.json"));
  await store.load();
  let notifications = 0;
  const app = http.createServer(createHandler({store,onSave:()=>{notifications++;}}));
  await new Promise(resolve => app.listen(0,"127.0.0.1",resolve));
  t.after(async () => { await new Promise(resolve => app.close(resolve)); await fs.rm(dir,{recursive:true,force:true}); });
  const origin = `http://127.0.0.1:${app.address().port}`;
  return {origin,store,notifications:()=>notifications};
}

test("editor loads assets, saves and exports the same persisted plan", async t => {
  const app = await server(t);
  const page = await fetch(`${app.origin}/lunch/`);
  assert.equal(page.status,200);
  assert.match(await page.text(),/Two-week menu/);
  for (const name of ["editor.js","editor.css","model.js","icon.svg","manifest.webmanifest"]) {
    assert.equal((await fetch(`${app.origin}/lunch/${name}`)).status,200,name);
  }
  const {plan,token} = await (await fetch(`${app.origin}/lunch/api/plan`)).json();
  plan.menu[0].lunch = "Saved lunch";
  const response = await fetch(`${app.origin}/lunch/api/plan`,{
    method:"PUT",headers:{"Content-Type":"application/json",Origin:app.origin,"X-Lunch-Token":token},body:JSON.stringify(plan)
  });
  assert.equal(response.status,200);
  assert.equal(app.notifications(),1);
  const saved = (await response.json()).plan;
  assert.equal(saved.revision,1);
  const exported = await fetch(`${app.origin}/lunch/api/export`);
  assert.equal(exported.headers.get("cache-control"),"no-store");
  assert.deepEqual(await exported.json(),saved);
  const conflict = await fetch(`${app.origin}/lunch/api/plan`,{
    method:"PUT",headers:{"Content-Type":"application/json",Origin:app.origin,"X-Lunch-Token":token},body:JSON.stringify(plan)
  });
  assert.equal(conflict.status,409);
});

test("cross-origin writes and missing tokens cannot change the plan", async t => {
  const app = await server(t);
  const {plan,token} = await (await fetch(`${app.origin}/lunch/api/plan`)).json();
  for (const [origin,provided] of [["https://other.example",token],[app.origin,""],[app.origin,"é".repeat(64)]]) {
    const response = await fetch(`${app.origin}/lunch/api/plan`,{
      method:"PUT",headers:{"Content-Type":"application/json",Origin:origin,"X-Lunch-Token":provided},body:JSON.stringify(plan)
    });
    assert.equal(response.status,403);
  }
  assert.equal(app.store.read().revision,0);
});

test("bad JSON, invalid plans, oversized payloads and non-JSON writes are rejected", async t => {
  const app = await server(t);
  const {token} = await (await fetch(`${app.origin}/lunch/api/plan`)).json();
  for (const [body,type,status] of [["{","application/json",400],["{}","application/json",400],["x","text/plain",415],["x".repeat(600001),"application/json",413]]) {
    const response = await fetch(`${app.origin}/lunch/api/plan`,{
      method:"PUT",headers:{"Content-Type":type,Origin:app.origin,"X-Lunch-Token":token},body
    });
    assert.equal(response.status,status);
  }
  assert.equal(app.store.read().revision,0);
});

test("Express originalUrl and an already-parsed body work with the same routes", async t => {
  const app = await server(t);
  const {plan,token} = await (await fetch(`${app.origin}/lunch/api/plan`)).json();
  const handler = createHandler({store:app.store});
  let state;
  const res = {setHeader(){},writeHead(status){this.status=status;},end(body){state=JSON.parse(body);}};
  const req = {method:"GET",url:"/api/plan",originalUrl:"/lunch/api/plan",headers:{host:"localhost:8080"},socket:{}};
  await handler(req,res);
  assert.equal(res.status,200);
  await handler({...req,method:"PUT",body:plan,headers:{host:"localhost:8080",origin:"http://localhost:8080","content-type":"application/json","x-lunch-token":state.token}},res);
  assert.equal(res.status,200);
  assert.equal(state.plan.revision,1);
});
