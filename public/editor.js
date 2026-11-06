/* Edits a local draft, uses the shared rotation logic, and saves with revision checks. */
"use strict";

(() => {
  const { DAYS, SLOTS, validatePlan, localClock, addDays, pickDate, buildDisplay } = globalThis.LunchData;
  const $ = id => document.getElementById(id);
  const LABELS = { amSnack: "AM snack", lunch: "Lunch", pmSnack: "PM snack" };
  let draft = null;
  let token = null;
  let dirty = false;
  let busy = false;
  let loading = false;
  let week = 1;
  let conflicted = false;

  function message(text, error = false, retry = false) {
    $("message").textContent = text;
    $("message").classList.toggle("error", error);
    if (retry) {
      const button = document.createElement("button");
      button.textContent = "Reload saved plan";
      button.addEventListener("click", () => load(true));
      $("message").appendChild(button);
    }
  }

  function updateSaveState() {
    $("save").disabled = !draft || !dirty || busy || conflicted;
    $("save").firstChild.textContent = busy ? "Saving… " : "Save changes ";
    $("save-state").textContent = conflicted ? "A newer version is available" : dirty ? "You have unsaved changes" : "Everything is up to date";
    $("save-detail").textContent = conflicted ? "Download your draft before reloading." : dirty ? "Save to update the shared plan and mirror." : draft?.updatedAt ? "Saved on your mirror." : "Your first save will create the shared plan.";
    $("download").textContent = dirty ? "Download draft" : "Download backup";
  }

  function markDirty() {
    dirty = true;
    updateSaveState();
    updatePreview();
  }

  function showPanel(name, focus = false) {
    for (const panel of ["today", "menu", "settings"]) {
      $(`panel-${panel}`).hidden = panel !== name;
      $(`tab-${panel}`).classList.toggle("active", panel === name);
      if (panel === name) $(`tab-${panel}`).setAttribute("aria-current", "page");
      else $(`tab-${panel}`).removeAttribute("aria-current");
    }
    if (focus) $("setting-monday").focus();
  }

  function humanDate(date) {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  }

  function renderCard(date, relative) {
    const food = pickDate(draft, date);
    const fragment = $("day-card-template").content.cloneNode(true);
    fragment.querySelector(".day-relative").textContent = relative.toUpperCase();
    fragment.querySelector(".day-name").textContent = food.day;
    fragment.querySelector(".day-meta").textContent = `${humanDate(date)}${food.week ? ` · Week ${food.week}` : ""}`;
    const tag = fragment.querySelector(".day-tag");
    tag.textContent = food.special ? "Date change" : "Repeating menu";
    const content = fragment.querySelector(".day-foods");
    if (food.status === "closed" || food.status === "setup") {
      const p = document.createElement("p");
      p.className = "day-empty";
      p.textContent = food.status === "closed" ? "No school. A little break from the routine." : "Choose your Week 1 Monday in Settings to start the rotation.";
      content.appendChild(p);
    } else {
      for (const key of SLOTS) {
        const row = document.createElement("div");
        row.className = "food-slot";
        const label = document.createElement("span");
        label.className = "food-label";
        label.textContent = LABELS[key];
        const text = document.createElement("p");
        text.className = `food-text${food[key] ? "" : " empty"}`;
        text.textContent = food[key] || "Add something to the menu";
        row.append(label, text);
        content.appendChild(row);
      }
    }
    fragment.querySelector(".change-day").addEventListener("click", () => openDate(date));
    return fragment;
  }

  function updatePreview() {
    if (!draft) return;
    $("plan-title").textContent = draft.settings.title || "Food plan";
    document.title = `${draft.settings.title || "Food plan"} · The everyday table`;
    try { validatePlan(draft); } catch { return; }
    const today = localClock(new Date(), draft.settings.timeZone).date;
    $("setup-hint").hidden = Boolean(draft.settings.week1Monday);
    $("day-cards").replaceChildren(renderCard(today, "Today"), renderCard(addDays(today, 1), "Tomorrow"));
    const display = buildDisplay(draft);
    $("mirror-note").textContent = `${dirty ? "After saving, the" : "The"} mirror ${dirty ? "will show" : "shows"} ${display.label.toLowerCase()} · ${display.day}${display.week ? ` · Week ${display.week}` : ""}.`;
    const upcoming = draft.overrides.filter(item => item.date >= today);
    $("changes-section").hidden = upcoming.length === 0;
    $("changes-list").replaceChildren();
    for (const item of upcoming) {
      const row = document.createElement("div");
      row.className = "change-row";
      const label = document.createElement("span");
      label.textContent = `${item.date} · ${item.closed ? "No school" : "Changed meals"}`;
      const button = document.createElement("button");
      button.className = "button subtle";
      button.textContent = "Edit";
      button.addEventListener("click", () => openDate(item.date));
      row.append(label, button);
      $("changes-list").appendChild(row);
    }
  }

  function renderMenu() {
    $("menu-days").replaceChildren();
    for (const number of [1, 2]) {
      $(`week-${number}`).classList.toggle("selected", week === number);
      $(`week-${number}`).setAttribute("aria-pressed", String(week === number));
    }
    for (const day of DAYS) {
      const row = draft.menu.find(item => item.week === week && item.day === day);
      const fragment = $("menu-day-template").content.cloneNode(true);
      fragment.querySelector(".weekday").textContent = day;
      const summary = fragment.querySelector(".menu-summary");
      const updateSummary = () => { summary.textContent = SLOTS.some(key => row[key]) ? row.lunch.replace(/\n/g, ", ") || "Snacks planned" : "Ready for your ideas"; };
      updateSummary();
      fragment.querySelector("details").open = day === "Monday";
      for (const key of SLOTS) {
        const container = document.createElement("div");
        const label = document.createElement("label");
        const id = `menu-${week}-${day}-${key}`;
        label.htmlFor = id;
        label.textContent = LABELS[key];
        const input = document.createElement("textarea");
        input.id = id;
        input.maxLength = 1000;
        input.rows = 4;
        input.value = row[key];
        input.placeholder = "One food per line…";
        input.addEventListener("input", () => { row[key] = input.value; updateSummary(); markDirty(); });
        container.append(label, input);
        fragment.querySelector(".meal-editors").appendChild(container);
      }
      $("menu-days").appendChild(fragment);
    }
  }

  function render() {
    $("main").inert = false;
    $("setting-title").value = draft.settings.title;
    $("setting-monday").value = draft.settings.week1Monday || "";
    $("setting-zone").value = draft.settings.timeZone;
    $("setting-show-tomorrow").checked = draft.settings.showTomorrowAfter !== null;
    $("setting-cutoff").value = draft.settings.showTomorrowAfter || "14:00";
    $("setting-cutoff").disabled = draft.settings.showTomorrowAfter === null;
    renderMenu();
    updatePreview();
    updateSaveState();
  }

  async function load(force = false) {
    if (busy || loading || (!force && (dirty || $("date-dialog").open))) return;
    loading = true;
    try {
      const response = await fetch("/lunch/api/plan", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not open the plan.");
      // An edit may have started while this refresh was in flight.
      if (!force && (dirty || busy || $("date-dialog").open)) return;
      token = result.token;
      draft = validatePlan(result.plan);
      dirty = false;
      conflicted = false;
      render();
      message(draft.updatedAt ? "Your shared plan is saved on the mirror." : "Welcome. Start with the two-week menu, then choose your Week 1 Monday.");
    } catch (error) { message(`${error.message} Check your connection to the mirror.`, true, !dirty); }
    finally { loading = false; }
  }

  async function save() {
    if (!draft || busy || conflicted) return;
    let plan;
    try { plan = validatePlan(draft); }
    catch (error) { message(error.message, true); showPanel("settings"); return; }
    busy = true;
    // Freeze the inputs during the request so a successful response cannot erase a later edit.
    $("main").inert = true;
    updateSaveState();
    try {
      const response = await fetch("/lunch/api/plan", {
        method: "PUT", headers: { "Content-Type": "application/json", "X-Lunch-Token": token },
        body: JSON.stringify(plan)
      });
      const result = await response.json();
      if (response.status === 409) { conflicted = true; throw new Error(result.error); }
      if (response.status === 403) { conflicted = true; throw new Error("The mirror restarted or this page expired. Download your draft, reload, then import the draft to review and save it."); }
      if (!response.ok) throw new Error(result.error || "The plan could not be saved.");
      draft = validatePlan(result.plan);
      dirty = false;
      render();
      message("Saved. The mirror has your latest plan.");
    } catch (error) { message(error.message, true, conflicted); }
    finally { busy = false; $("main").inert = false; updateSaveState(); }
  }

  function openDate(date) {
    if (!draft) return;
    $("override-date").value = date || localClock(new Date(), draft.settings.timeZone).date;
    fillDate();
    $("date-dialog").showModal();
  }

  function fillDate() {
    const date = $("override-date").value;
    if (!date) return;
    let food;
    try { food = pickDate(draft, date); } catch { return; }
    $("override-closed").checked = food.status === "closed";
    $("override-meals").disabled = food.status === "closed";
    for (const key of SLOTS) $(`override-${key}`).value = food[key];
    $("restore-date").disabled = !draft.overrides.some(item => item.date === date);
  }

  function download() {
    if (!draft) return;
    const blob = new Blob([JSON.stringify(draft, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = dirty ? "food-plan-draft.json" : "food-plan.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  document.querySelectorAll("[data-panel]").forEach(button => button.addEventListener("click", () => showPanel(button.dataset.panel)));
  $("setup-button").addEventListener("click", () => showPanel("settings", true));
  for (const number of [1, 2]) $(`week-${number}`).addEventListener("click", () => { week = number; renderMenu(); });
  $("setting-title").addEventListener("input", event => { draft.settings.title = event.target.value; markDirty(); });
  $("setting-monday").addEventListener("change", event => { draft.settings.week1Monday = event.target.value || null; markDirty(); });
  $("setting-zone").addEventListener("change", event => { draft.settings.timeZone = event.target.value.trim(); markDirty(); });
  $("setting-show-tomorrow").addEventListener("change", event => {
    draft.settings.showTomorrowAfter = event.target.checked ? $("setting-cutoff").value || "14:00" : null;
    $("setting-cutoff").disabled = !event.target.checked;
    markDirty();
  });
  $("setting-cutoff").addEventListener("change", event => { draft.settings.showTomorrowAfter = event.target.value; markDirty(); });
  $("save").addEventListener("click", save);
  $("choose-date").addEventListener("click", () => openDate());
  $("close-date").addEventListener("click", () => $("date-dialog").close());
  $("override-date").addEventListener("change", fillDate);
  $("override-closed").addEventListener("change", event => { $("override-meals").disabled = event.target.checked; });
  $("date-form").addEventListener("submit", event => {
    event.preventDefault();
    const date = $("override-date").value;
    draft.overrides = draft.overrides.filter(row => row.date !== date);
    draft.overrides.push({ date, closed: $("override-closed").checked, ...Object.fromEntries(SLOTS.map(key => [key, $(`override-${key}`).value.trim()])) });
    $("date-dialog").close();
    markDirty();
    message("Date change added to your draft. Tap Save changes to update the mirror.");
  });
  $("restore-date").addEventListener("click", () => {
    const date = $("override-date").value;
    draft.overrides = draft.overrides.filter(row => row.date !== date);
    $("date-dialog").close();
    markDirty();
    message("Repeating menu restored in your draft. Tap Save changes to update the mirror.");
  });
  $("download").addEventListener("click", download);
  $("import-file").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file || !draft) return;
    try {
      if (file.size > 600000) throw new Error("Choose a food-plan backup smaller than 600 KB.");
      const imported = validatePlan(JSON.parse(await file.text()));
      imported.revision = draft.revision;
      imported.updatedAt = draft.updatedAt;
      draft = imported;
      dirty = true;
      render();
      message("Backup loaded as a draft. Review the menu and settings, then tap Save changes.");
    } catch (error) { message(`Could not import: ${error.message}`, true); }
    finally { event.target.value = ""; }
  });
  window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  setInterval(() => load(), 30000);
  load();
})();
