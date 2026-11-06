/* Local editor routes shared by the MagicMirror helper and standalone preview. */
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const { randomBytes, timingSafeEqual } = require("node:crypto");
const { buildDisplay, localClock, pickDate, addDays, PlanError } = require("./lunch-data");

const MAX_BODY = 600000;
const ASSETS = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/editor.js", ["editor.js", "text/javascript; charset=utf-8"]],
  ["/model.js", ["../lunch-data.js", "text/javascript; charset=utf-8"]],
  ["/editor.css", ["editor.css", "text/css; charset=utf-8"]],
  ["/icon.svg", ["icon.svg", "image/svg+xml"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json"]]
]);

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) throw new PlanError("Send the plan as JSON.", 415);
  if (Number(req.headers["content-length"]) > MAX_BODY) throw new PlanError("The plan file is too large.", 413);
  // MagicMirror may already have consumed JSON through its Express middleware.
  if (req.body !== undefined) {
    if (Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY) throw new PlanError("The plan file is too large.", 413);
    return req.body;
  }
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY) throw new PlanError("The plan file is too large.", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new PlanError("The file is not valid JSON."); }
}

function allowedHost(host, extraHosts) {
  const name = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (net.isIP(name)) return true;
  const machine = os.hostname().toLowerCase().replace(/\.local$/, "");
  return ["localhost", machine, `${machine}.local`, ...extraHosts].includes(name);
}

function createHandler({ store, onSave = () => {}, now = () => new Date(), allowedHosts = [] }) {
  const token = randomBytes(32).toString("hex");
  return async function handle(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
    try {
      let origin;
      try { origin = new URL(`${req.socket.encrypted ? "https" : "http"}://${req.headers.host}`); }
      catch { throw new PlanError("Invalid host.", 403); }
      if (!allowedHost(origin.hostname, allowedHosts)) throw new PlanError("Use the mirror's IP address or its local hostname.", 403);
      const url = new URL(req.originalUrl || req.url, origin);
      const route = url.pathname.slice("/lunch".length);
      if (req.method === "GET" && route === "") {
        res.writeHead(302, { Location: "/lunch/" });
        res.end();
        return;
      }
      if (req.method === "GET" && ASSETS.has(route)) {
        const [file, contentType] = ASSETS.get(route);
        const body = await fs.readFile(path.join(__dirname, "public", file));
        res.writeHead(200, { "Content-Type": contentType });
        res.end(body);
        return;
      }
      if (req.method === "GET" && route === "/api/plan") {
        const plan = store.read();
        const clock = localClock(now(), plan.settings.timeZone);
        json(res, 200, {
          plan, token,
          today: pickDate(plan, clock.date), tomorrow: pickDate(plan, addDays(clock.date, 1)),
          display: buildDisplay(plan, now())
        });
        return;
      }
      if (req.method === "GET" && route === "/api/export") {
        res.setHeader("Content-Disposition", 'attachment; filename="food-plan.json"');
        json(res, 200, store.read());
        return;
      }
      if (req.method === "PUT" && route === "/api/plan") {
        const provided = req.headers["x-lunch-token"] || "";
        if (req.headers.origin !== origin.origin || typeof provided !== "string" || Buffer.byteLength(provided) !== token.length
            || !timingSafeEqual(Buffer.from(provided), Buffer.from(token))) {
          throw new PlanError("Reload this page before saving.", 403);
        }
        const plan = await store.save(await readJson(req));
        // A display notification failure must not turn a completed disk save into a failed save.
        try { await onSave(plan); } catch (error) { console.error("[MMM-Lunch] display update failed:", error.message); }
        json(res, 200, { plan });
        return;
      }
      json(res, 404, { error: "Page not found." });
    } catch (error) {
      const status = error instanceof PlanError ? error.status : 503;
      if (status === 503) console.error("[MMM-Lunch] menu request failed:", error.message);
      if (!res.headersSent) json(res, status, { error: status === 503 ? "The menu could not be read or saved. Your draft is still on this page. Check the mirror logs." : error.message });
      else res.end();
    }
  };
}

module.exports = { createHandler, MAX_BODY };
