import * as fs from "node:fs";
import * as path from "node:path";
import type { Config } from "./config.js";

const STORAGE_FILE = path.resolve("last-run.json");

export function getLastRunAt(config: Config): string | null {
  if (config.lastRunStorage === "env") {
    return config.lastRunAt ?? null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8"));
    return data.lastRunAt ?? null;
  } catch {
    return null;
  }
}

export function saveLastRunAt(config: Config, timestamp: string): void {
  if (config.lastRunStorage === "env") {
    console.log(
      `[storage] LAST_RUN_STORAGE=env — update LAST_RUN_AT to: ${timestamp}`
    );
    return;
  }

  fs.writeFileSync(
    STORAGE_FILE,
    JSON.stringify({ lastRunAt: timestamp }, null, 2)
  );
  console.log(`[storage] Saved lastRunAt=${timestamp} to ${STORAGE_FILE}`);
}
