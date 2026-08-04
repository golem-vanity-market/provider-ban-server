import { config } from "./config.ts";
import { openDb, Store } from "./db.ts";
import { Collector } from "./collector.ts";
import { seedFromEstimatorsFile } from "./seed.ts";
import { createHandler } from "./api.ts";

console.log(
  `[main] provider-ban-server starting (port ${config.port}, db ${config.dbPath})`,
);

const db = openDb();
const store = new Store(db);

seedFromEstimatorsFile(store);

const collector = new Collector(store);
collector.start();

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  fetch: createHandler(store, collector),
});

console.log(`[main] listening on http://${config.host}:${config.port}`);

function shutdown(): void {
  console.log("[main] shutting down");
  collector.stop();
  server.stop(true);
  db.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
