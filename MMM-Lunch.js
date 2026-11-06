/* MagicMirror display only; plan storage and all editor I/O live in the helper. */
"use strict";

Module.register("MMM-Lunch", {
  requiresVersion: "2.38.0",
  defaults: {
    dataFile: "/persist/magicmirror/lunch/plan.json",
    allowedHosts: [],
    weekendText: "No school today",
    emptyText: "No food planned"
  },

  start() {
    this.food = null;
    this.sendSocketNotification("LUNCH_CONFIG", {
      dataFile: this.config.dataFile, allowedHosts: this.config.allowedHosts
    });
  },

  getStyles() { return ["MMM-Lunch.css"]; },

  socketNotificationReceived(notification, payload) {
    if (notification !== "LUNCH_DATA") return;
    this.food = payload;
    this.updateDom();
  },

  getDom() {
    const wrapper = document.createElement("div");
    wrapper.className = "lunch-plan small";
    const line = (text, className, parent = wrapper) => {
      const element = document.createElement("div");
      element.className = className;
      element.textContent = text;
      parent.appendChild(element);
      return element;
    };
    const food = this.food;
    if (!food) { line("Loading food plan…", "dimmed"); return wrapper; }
    if (food.status === "error") { line(food.message, "dimmed"); return wrapper; }
    line(`${food.label} · ${food.day}${food.week ? ` · Week ${food.week}` : ""}`, "dimmed lunch-date");
    if (food.status === "closed") {
      line(food.label === "Tomorrow" ? "No school tomorrow" : this.config.weekendText, "bright");
      return wrapper;
    }
    if (food.status === "setup") {
      line("Set Week 1 in the food planner", "dimmed");
      return wrapper;
    }
    if (food.status === "empty") { line(this.config.emptyText, "dimmed"); return wrapper; }
    for (const [key, label] of [["amSnack", "AM snack"], ["lunch", "Lunch"], ["pmSnack", "PM snack"]]) {
      const slot = line("", "lunch-slot");
      line(label, "dimmed lunch-label", slot);
      line(food[key] || "Nothing listed", "bright lunch-food", slot);
    }
    if (food.special) line("Plan for this date", "dimmed lunch-special");
    return wrapper;
  }
});
