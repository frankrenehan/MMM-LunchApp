/* Hosts the shared editor and sends locally selected meals to MagicMirror. */
"use strict";

const NodeHelper = require("node_helper");
const path = require("node:path");
const { PlanStore } = require("./lunch-store");
const { createHandler } = require("./lunch-http");
const { buildDisplay } = require("./lunch-data");

module.exports = NodeHelper.create({
  start() {
    this.store = null;
    this.handler = null;
    this.timer = null;
    this.initializing = null;
    this.dataFile = null;
    this.errorState = null;
    this.stopped = false;
    this.expressApp.use("/lunch", (req, res) => {
      // The shared handler reads originalUrl when Express strips the mount point.
      if (!this.handler) {
        res.status(503).json({ error: "The food planner is not ready. Check the mirror configuration and logs." });
        return;
      }
      this.handler(req, res);
    });
  },

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
  },

  async socketNotificationReceived(notification, payload) {
    if (notification !== "LUNCH_CONFIG") return;
    const filename = payload && payload.dataFile || "/persist/magicmirror/lunch/plan.json";
    if (typeof filename !== "string" || !path.isAbsolute(filename)) {
      this.sendSocketNotification("LUNCH_DATA", { status: "error", message: "Set dataFile to an absolute persistent path." });
      return;
    }
    if (this.dataFile && this.dataFile !== filename) {
      this.sendSocketNotification("LUNCH_DATA", { status: "error", message: "All MMM-Lunch instances must share the same dataFile." });
      return;
    }
    if (!this.initializing) {
      this.dataFile = filename;
      this.initializing = this.initialize(filename, payload && payload.allowedHosts);
    }
    await this.initializing;
    this.emit();
  },

  async initialize(filename, allowedHosts) {
    try {
      if (allowedHosts !== undefined && (!Array.isArray(allowedHosts) || !allowedHosts.every(host => typeof host === "string" && /^[a-z\d.-]+$/i.test(host)))) {
        throw new Error("allowedHosts must be an array of local hostname strings.");
      }
      this.store = new PlanStore(filename);
      await this.store.load();
      if (this.stopped) return;
      this.handler = createHandler({ store: this.store, allowedHosts, onSave: () => this.emit() });
      // Day/cutoff rollover does not depend on an internet fetch or browser refresh.
      this.timer = setInterval(() => this.emit(), 15000);
      console.log("[MMM-Lunch] local planner ready at /lunch/");
    } catch (error) {
      console.error("[MMM-Lunch] could not load food plan:", error.message);
      this.errorState = { status: "error", message: "Food plan unavailable. Check the mirror logs." };
    }
  },

  emit() {
    if (this.stopped) return;
    this.sendSocketNotification("LUNCH_DATA", this.errorState || buildDisplay(this.store.read()));
  }
});
