/* Exercises rotation, local time boundaries, validation, and date overrides. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { blankPlan, validatePlan, pickDate, buildDisplay, localClock } = require("../lunch-data");

function plan() {
  const value = blankPlan();
  value.settings.week1Monday = "2026-11-02";
  for (const row of value.menu) {
    row.amSnack = `Week ${row.week} ${row.day} snack`;
    row.lunch = `Week ${row.week} ${row.day} lunch`;
    row.pmSnack = "Yoghurt\nFruit";
  }
  return value;
}

test("two-week rotation covers every weekday, earlier dates, holidays, and New Year", () => {
  const value = plan();
  for (const [date, expected] of [["2026-11-02",1],["2026-11-03",1],["2026-11-04",1],["2026-11-05",1],["2026-11-06",1],["2026-11-09",2],["2026-11-10",2],["2026-11-11",2],["2026-11-12",2],["2026-11-13",2],["2026-11-16",1],["2026-10-26",2],["2026-12-28",1],["2027-01-04",2]]) {
    assert.equal(pickDate(value, date).week, expected, date);
  }
  assert.equal(pickDate(value,"2026-11-07").status,"closed");
  assert.equal(pickDate(value,"2026-11-08").status,"closed");
});

test("New York midnight and cutoff use the plan timezone, independent of host timezone", () => {
  const value = plan();
  value.settings.showTomorrowAfter = null;
  assert.equal(buildDisplay(value,new Date("2026-11-07T04:30:00Z")).date,"2026-11-06");
  assert.equal(buildDisplay(value,new Date("2026-11-07T05:30:00Z")).date,"2026-11-07");
  value.settings.showTomorrowAfter = "14:00";
  assert.equal(buildDisplay(value,new Date("2026-11-06T18:59:59Z")).label,"Today");
  const after = buildDisplay(value,new Date("2026-11-06T19:00:00Z"));
  assert.equal(after.label,"Tomorrow");
  assert.equal(after.date,"2026-11-07");
  assert.equal(after.status,"closed");
});

test("DST changes do not shift weekday or rotation", () => {
  const value = plan();
  value.settings.week1Monday = "2026-03-02";
  value.settings.showTomorrowAfter = null;
  assert.equal(buildDisplay(value,new Date("2026-03-09T04:30:00Z")).date,"2026-03-09");
  assert.equal(buildDisplay(value,new Date("2026-03-09T04:30:00Z")).week,2);
  assert.equal(localClock(new Date("2026-11-01T05:30:00Z")).time,"01:30");
  assert.equal(localClock(new Date("2026-11-01T06:30:00Z")).time,"01:30");
});

test("overrides replace a complete day, close weekdays, open weekends, and can precede setup", () => {
  const value = plan();
  value.overrides = [
    {date:"2026-11-06",closed:true,amSnack:"",lunch:"",pmSnack:""},
    {date:"2026-11-07",closed:false,amSnack:"Fruit",lunch:"Picnic",pmSnack:""}
  ];
  assert.equal(pickDate(value,"2026-11-06").status,"closed");
  assert.equal(pickDate(value,"2026-11-07").lunch,"Picnic");
  assert.equal(pickDate(value,"2026-11-07").pmSnack,"");
  value.settings.week1Monday = null;
  assert.equal(pickDate(value,"2026-11-07").status,"ready");
  assert.equal(pickDate(value,"2026-11-09").status,"setup");
});

test("blank meals stay blank and multiline values survive validation", () => {
  const value = plan();
  value.menu[0].amSnack = "  yoghurt\r\nfruit  ";
  assert.equal(validatePlan(value).menu[0].amSnack,"yoghurt\nfruit");
  value.menu[0].amSnack = "";
  value.menu[0].lunch = "";
  value.menu[0].pmSnack = "";
  assert.equal(pickDate(value,"2026-11-02").status,"empty");
});

test("invalid/ambiguous plans and oversized content are rejected", () => {
  for (const mutate of [
    p => { p.settings.week1Monday = "2026-11-03"; },
    p => { p.settings.week1Monday = "2026-02-30"; },
    p => { p.settings.timeZone = "not-a-zone"; },
    p => { p.settings.showTomorrowAfter = "25:00"; },
    p => { p.menu[0] = p.menu[1]; },
    p => { p.menu[0].lunch = "x".repeat(1001); },
    p => { p.revision = -1; },
    p => { p.schemaVersion = 9; }
  ]) {
    const value = plan(); mutate(value);
    assert.throws(() => validatePlan(value));
  }
});
