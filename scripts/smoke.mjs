import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";

const mode = process.argv[2] ?? "list";
const client = new Client({ name: "web-search-mcp-smoke", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.resolve("dist/src/server.js")],
  env: Object.fromEntries(
    Object.entries({ ...process.env, WEB_SEARCH_HEADLESS: process.env.WEB_SEARCH_HEADLESS ?? "true" })
      .filter((entry) => entry[1] !== undefined),
  ),
  stderr: "inherit",
});

try {
  await client.connect(transport);
  if (mode === "list") {
    console.log(JSON.stringify(await client.listTools(), null, 2));
  } else if (mode === "read") {
    console.log(JSON.stringify(await client.callTool({
      name: "read_pages",
      arguments: {
        urls: ["https://www.uaz.ru/owner/manuals"],
        render: "fallback",
        maxCharactersPerPage: 3_000,
      },
    }), null, 2));
  } else if (mode === "search") {
    console.log(JSON.stringify(await client.callTool({
      name: "web_search",
      arguments: {
        query: process.argv.slice(3).join(" ") || "УАЗ Патриот заводской вылет диска",
        engine: process.env.SMOKE_ENGINE ?? "yandex",
        limit: 5,
        operatorWaitSeconds: Number(process.env.SMOKE_OPERATOR_WAIT_SECONDS ?? 0),
      },
    }), null, 2));
  } else {
    throw new Error(`Unknown smoke mode: ${mode}`);
  }
} finally {
  await client.close();
}
