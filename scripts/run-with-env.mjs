import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

export async function readEnvFile(path) {
  const result = {};
  for (const line of (await readFile(path, "utf8")).split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

export function postgresConnectionUrl(value) {
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Expected a PostgreSQL DATABASE_URL.");
  for (const key of ["schema", "connection_limit", "pool_timeout", "pgbouncer", "socket_timeout", "statement_cache_size"]) {
    url.searchParams.delete(key);
  }
  return url.toString();
}

const [envFile, command, ...args] = process.argv.slice(2);
if (!envFile || !command) throw new Error("Usage: node scripts/run-with-env.mjs <env-file> <command> [args]");
const values = await readEnvFile(envFile);
if (command === "--postgres-url") {
  process.stdout.write(postgresConnectionUrl(values.DATABASE_URL));
} else if (command === "--read") {
  process.stdout.write(values[args[0]] ?? "");
} else {
  const child = spawn(command, args, { env: { ...process.env, ...values }, stdio: "inherit" });
  child.once("error", error => { console.error(error.message); process.exitCode = 1; });
  child.once("exit", (code, signal) => { process.exitCode = signal ? 1 : code ?? 1; });
}
