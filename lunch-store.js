/* Serializes edits, checks revisions, and writes durable plans outside the module. */
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { blankPlan, validatePlan, PlanError } = require("./lunch-data");

async function atomicWrite(filename, content) {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, filename);
    // Flush the directory entry as well as the file before acknowledging Save.
    const directory = await fs.open(path.dirname(filename), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    if (handle) await handle.close();
    await fs.unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}

class PlanStore {
  constructor(filename, { now = () => new Date(), write = atomicWrite } = {}) {
    this.filename = filename;
    this.now = now;
    this.write = write;
    this.plan = null;
    this.queue = Promise.resolve();
  }

  async load() {
    let text;
    try { text = await fs.readFile(this.filename, "utf8"); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.plan = blankPlan();
      return this.read();
    }
    // An unreadable/corrupt plan is never silently replaced with an empty one.
    this.plan = validatePlan(JSON.parse(text));
    return this.read();
  }

  read() {
    if (!this.plan) throw new Error("The food plan is not loaded.");
    return structuredClone(this.plan);
  }

  save(input) {
    const operation = this.queue.then(async () => {
      const next = validatePlan(input);
      if (next.revision !== this.plan.revision) throw new PlanError("Someone else saved this plan. Download your draft, then reload the latest version before editing again.", 409);
      next.revision = this.plan.revision + 1;
      next.updatedAt = this.now().toISOString();
      if (this.plan.revision > 0) await this.write(`${this.filename}.bak`, JSON.stringify(this.plan, null, 2) + "\n");
      await this.write(this.filename, JSON.stringify(next, null, 2) + "\n");
      this.plan = next;
      return this.read();
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}

module.exports = { PlanStore, atomicWrite };
