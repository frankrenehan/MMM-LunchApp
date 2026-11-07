"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { blankPlan, mondayOf, shoppingPrompt } = require("../lunch-data");

test("mondayOf finds the Monday of any day", () => {
  assert.equal(mondayOf("2026-11-09"), "2026-11-09");
  assert.equal(mondayOf("2026-11-13"), "2026-11-09");
  assert.equal(mondayOf("2026-11-15"), "2026-11-09");
  assert.equal(mondayOf("2027-01-01"), "2026-12-28");
});

test("shoppingPrompt lists the week's meals, closed days and empty days", () => {
  const plan = blankPlan();
  plan.settings.week1Monday = "2026-11-02";
  const mon = plan.menu.find(r => r.week === 2 && r.day === "Monday");
  mon.lunch = "Ham sandwich\n Apple ";
  mon.amSnack = "Yogurt";
  plan.overrides.push({ date: "2026-11-11", closed: true, amSnack: "", lunch: "", pmSnack: "" });
  const text = shoppingPrompt(plan, "2026-11-09");
  assert.match(text, /week of Nov 9 \(Week 2/);
  assert.match(text, /Monday, Nov 9\n- AM snack: Yogurt\n- Lunch: Ham sandwich, Apple\n/);
  assert.match(text, /Wednesday, Nov 11\n- No school/);
  assert.match(text, /Tuesday, Nov 10\n- Nothing planned yet/);
  assert.doesNotMatch(text, /- PM snack/);
});
