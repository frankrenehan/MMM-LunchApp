/* Pure validation, local-calendar rotation, and display selection for MMM-Lunch. */
"use strict";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const SLOTS = ["amSnack", "lunch", "pmSnack"];
const DAY_MS = 86400000;

class PlanError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value, field, max = 1000) {
  if (typeof value !== "string" || value.length > max) {
    throw new PlanError(`${field} must be text of at most ${max} characters.`);
  }
  return value.replace(/\r\n?/g, "\n").trim();
}

function dateNumber(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 2000 || year > 2199) return NaN;
  const ms = Date.UTC(year, month - 1, day);
  return new Date(ms).toISOString().slice(0, 10) === value ? ms / DAY_MS : NaN;
}

function addDays(date, count) {
  return new Date((dateNumber(date) + count) * DAY_MS).toISOString().slice(0, 10);
}

function weekday(date) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" })
    .format(new Date(dateNumber(date) * DAY_MS));
}

function localClock(now = new Date(), timeZone = "America/New_York") {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function blankPlan() {
  return {
    schemaVersion: 1,
    revision: 0,
    updatedAt: null,
    settings: {
      title: "Food plan", week1Monday: null,
      timeZone: "America/New_York", showTomorrowAfter: "14:00"
    },
    menu: [1, 2].flatMap(week => DAYS.map(day => ({
      week, day, amSnack: "", lunch: "", pmSnack: ""
    }))),
    overrides: []
  };
}

function validatePlan(input) {
  if (!plain(input) || input.schemaVersion !== 1) throw new PlanError("This is not a supported food-plan file.");
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw new PlanError("The plan revision is invalid.");
  if (input.updatedAt !== null && (typeof input.updatedAt !== "string" || !Number.isFinite(Date.parse(input.updatedAt)))) {
    throw new PlanError("The saved time is invalid.");
  }
  if (!plain(input.settings)) throw new PlanError("Plan settings are missing.");
  const { week1Monday, timeZone, showTomorrowAfter } = input.settings;
  const title = cleanText(input.settings.title, "Plan title", 80);
  if (!title) throw new PlanError("Enter a title for the plan.");
  if (week1Monday !== null && (!Number.isFinite(dateNumber(week1Monday)) || weekday(week1Monday) !== "Monday")) {
    throw new PlanError("Week 1 must start on a valid Monday.");
  }
  if (typeof timeZone !== "string" || timeZone.length > 80) throw new PlanError("Choose a valid timezone.");
  try { new Intl.DateTimeFormat("en", { timeZone }).format(); }
  catch { throw new PlanError("Choose a valid timezone, such as America/New_York."); }
  if (showTomorrowAfter !== null && (typeof showTomorrowAfter !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(showTomorrowAfter))) {
    throw new PlanError("The tomorrow cutoff must be HH:MM or disabled.");
  }
  if (!Array.isArray(input.menu) || input.menu.length !== 10) throw new PlanError("The menu must contain five days for each of two weeks.");
  const seen = new Set();
  const menu = input.menu.map(row => {
    if (!plain(row) || ![1, 2].includes(row.week) || !DAYS.includes(row.day)) throw new PlanError("Each menu row needs week 1 or 2 and a weekday.");
    const key = `${row.week}:${row.day}`;
    if (seen.has(key)) throw new PlanError(`Duplicate menu day: week ${row.week}, ${row.day}.`);
    seen.add(key);
    return { week: row.week, day: row.day, ...Object.fromEntries(SLOTS.map(slot => [slot, cleanText(row[slot], slot)])) };
  }).sort((a, b) => a.week - b.week || DAYS.indexOf(a.day) - DAYS.indexOf(b.day));
  if (!Array.isArray(input.overrides) || input.overrides.length > 366) throw new PlanError("Keep at most 366 date changes in one plan.");
  const dates = new Set();
  const overrides = input.overrides.map(row => {
    if (!plain(row) || !Number.isFinite(dateNumber(row.date)) || typeof row.closed !== "boolean") throw new PlanError("Each date change needs a valid date and closed flag.");
    if (dates.has(row.date)) throw new PlanError(`Duplicate date change: ${row.date}.`);
    dates.add(row.date);
    return {
      date: row.date, closed: row.closed,
      ...Object.fromEntries(SLOTS.map(slot => [slot, cleanText(row[slot], slot)]))
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
  return {
    schemaVersion: 1, revision: input.revision, updatedAt: input.updatedAt,
    settings: { title, week1Monday, timeZone, showTomorrowAfter }, menu, overrides
  };
}

function pickDate(plan, date) {
  if (!Number.isFinite(dateNumber(date))) throw new PlanError("Choose a valid date.");
  const day = weekday(date);
  const override = plan.overrides.find(row => row.date === date);
  const anchor = plan.settings.week1Monday;
  const week = anchor ? ((Math.floor((dateNumber(date) - dateNumber(anchor)) / 7) % 2) + 2) % 2 + 1 : null;
  const base = { date, day, week, title: plan.settings.title, special: Boolean(override), amSnack: "", lunch: "", pmSnack: "" };
  if (override) return { ...base, ...override, status: override.closed ? "closed" : SLOTS.some(slot => override[slot]) ? "ready" : "empty" };
  if (!DAYS.includes(day)) return { ...base, status: "closed" };
  if (!anchor) return { ...base, status: "setup" };
  const row = plan.menu.find(row => row.week === week && row.day === day);
  return { ...base, ...row, status: SLOTS.some(slot => row[slot]) ? "ready" : "empty" };
}

function buildDisplay(plan, now = new Date()) {
  const clock = localClock(now, plan.settings.timeZone);
  const tomorrow = plan.settings.showTomorrowAfter !== null && clock.time >= plan.settings.showTomorrowAfter;
  return { ...pickDate(plan, addDays(clock.date, tomorrow ? 1 : 0)), label: tomorrow ? "Tomorrow" : "Today" };
}

function mondayOf(date) {
  // dateNumber 0 (1970-01-01) was a Thursday, so Monday-based offset is (n + 3) % 7.
  return addDays(date, -(((dateNumber(date) + 3) % 7 + 7) % 7));
}

function shoppingPrompt(plan, monday) {
  const LABEL = { amSnack: "AM snack", lunch: "Lunch", pmSnack: "PM snack" };
  const nice = date => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(dateNumber(date) * DAY_MS));
  const days = DAYS.map((_, i) => pickDate(plan, addDays(monday, i)));
  const lines = [];
  for (const food of days) {
    lines.push(`${food.day}, ${nice(food.date)}`);
    if (food.status === "closed") lines.push("- No school, nothing needed");
    else if (food.status === "setup" || food.status === "empty") lines.push("- Nothing planned yet");
    else for (const slot of SLOTS) {
      if (food[slot]) lines.push(`- ${LABEL[slot]}: ${food[slot].split("\n").map(x => x.trim()).filter(Boolean).join(", ")}`);
    }
    lines.push("");
  }
  const week = days[0].week ? ` (Week ${days[0].week} of our rotation)` : "";
  return [
    `Here is the school food plan for the week of ${nice(monday)}${week}: an AM snack, a packed lunch and a PM snack each school day.`,
    "Please turn it into a grocery shopping list: combine repeated items, estimate quantities for these days, group the list by store section, and flag anything that needs to be bought fresh mid-week. Leave out common pantry staples unless they are listed.",
    "",
    ...lines
  ].join("\n").trim() + "\n";
}

const LunchData = { DAYS, SLOTS, PlanError, blankPlan, validatePlan, dateNumber, addDays, weekday, localClock, pickDate, buildDisplay, mondayOf, shoppingPrompt };
if (typeof module !== "undefined" && module.exports) module.exports = LunchData;
else globalThis.LunchData = LunchData;
