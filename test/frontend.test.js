/* Verifies safe text rendering and the display states without Electron. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function display(food) {
  let definition;
  const document = {createElement:tag=>({tag,children:[],textContent:"",appendChild(item){this.children.push(item);}})};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,"..","MMM-Lunch.js"),"utf8"),{Module:{register:(name,value)=>{definition=value;}},document});
  definition.config = {...definition.defaults};
  definition.food = food;
  const flatten = node => [node.textContent,...node.children.flatMap(flatten)];
  return flatten(definition.getDom()).join("\n");
}

test("meal values are rendered as text and retain multiline content", () => {
  const text = display({status:"ready",label:"Today",day:"Monday",week:1,amSnack:"Yoghurt\nFruit",lunch:"<img src=x onerror=alert(1)>",pmSnack:""});
  assert.match(text,/Yoghurt\nFruit/);
  assert.match(text,/<img src=x onerror=alert\(1\)>/);
  assert.match(text,/Nothing listed/);
});

test("closed, setup, empty, and error states have useful display text", () => {
  assert.match(display({status:"closed",label:"Tomorrow",day:"Saturday"}),/No school tomorrow/);
  assert.match(display({status:"setup",label:"Today",day:"Monday"}),/Set Week 1/);
  assert.match(display({status:"empty",label:"Today",day:"Monday"}),/No food planned/);
  assert.match(display({status:"error",message:"Unavailable"}),/Unavailable/);
});
