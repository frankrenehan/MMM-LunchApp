/* Standalone loopback preview of the same editor and storage used on the Pi. */
"use strict";

const http = require("node:http");
const path = require("node:path");
const { PlanStore } = require("./lunch-store");
const { createHandler } = require("./lunch-http");

async function main() {
  const filename = process.env.LUNCH_DATA_FILE || path.join(__dirname, ".local", "plan.json");
  const store = new PlanStore(filename);
  await store.load();
  const handler = createHandler({ store });
  const server = http.createServer((req, res) => {
    if (req.url === "/") { res.writeHead(302, { Location: "/lunch/" }); res.end(); }
    else if (req.url.startsWith("/lunch/") || req.url === "/lunch") handler(req, res);
    else { res.writeHead(404); res.end("Not found"); }
  });
  server.requestTimeout = 15000;
  const port = Number(process.env.PORT || 8097);
  server.listen(port, "127.0.0.1", () => console.log(`[MMM-Lunch] preview: http://127.0.0.1:${port}/lunch/`));
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch(error => { console.error("[MMM-Lunch]", error.message); process.exitCode = 1; });
