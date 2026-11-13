import { cp, access } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
const root = process.cwd();
process.env.NODE_ENV = "production";
loadEnvConfig(root, false);
const { values } = parseArgs({
  options: {
    port: { type: "string", short: "p" },
    hostname: { type: "string", short: "H" },
  },
});
const port = values.port ?? process.env.PORT ?? "3000";
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
  throw new Error("Invalid port.");
process.env.PORT = port;
process.env.HOSTNAME = values.hostname ?? "0.0.0.0";
for (const [key, fallback] of [
  ["EMBEDDING_CACHE_DIR", ".data/models"],
  ["LANCEDB_DIR", ".data/lancedb"],
])
  process.env[key] = resolve(root, process.env[key] ?? fallback);
const standalone = resolve(root, ".next/standalone");
await access(resolve(standalone, "server.js"));
await cp(resolve(root, "public"), resolve(standalone, "public"), {
  recursive: true,
});
await cp(resolve(root, ".next/static"), resolve(standalone, ".next/static"), {
  recursive: true,
});
await import(pathToFileURL(resolve(standalone, "server.js")).href);
