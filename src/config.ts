import os from "node:os";
import path from "node:path";

export interface Config {
  chromePath?: string;
  profileDir: string;
  headless: boolean;
  searchTimeoutMs: number;
  fetchTimeoutMs: number;
  fetchMaxBytes: number;
  userAgent: string;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function boolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false`);
}

export function loadConfig(): Config {
  return {
    ...(process.env.WEB_SEARCH_CHROME_PATH
      ? { chromePath: path.resolve(process.env.WEB_SEARCH_CHROME_PATH) }
      : {}),
    profileDir: path.resolve(
      process.env.WEB_SEARCH_PROFILE_DIR
        ?? path.join(os.homedir(), ".web-search-mcp", "chrome-profile"),
    ),
    headless: boolean("WEB_SEARCH_HEADLESS", false),
    searchTimeoutMs: positiveInteger("WEB_SEARCH_TIMEOUT_MS", 30_000),
    fetchTimeoutMs: positiveInteger("WEB_FETCH_TIMEOUT_MS", 20_000),
    fetchMaxBytes: positiveInteger("WEB_FETCH_MAX_BYTES", 5 * 1024 * 1024),
    userAgent: process.env.WEB_FETCH_USER_AGENT
      ?? "WebSearchMCP/0.1 (+local personal research tool)",
  };
}
