import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserManager } from "../src/browser.js";
import type { Config } from "../src/config.js";
import { extractArticle, paginateText, readPage } from "../src/reader.js";

test("extracts main article instead of navigation", () => {
  const html = `<!doctype html><html><head><title>Как подобрать диски</title></head><body>
    <nav>Главная Каталог Контакты</nav>
    <article><h1>Как подобрать диски</h1><p>${"Полезный текст о вылете колёсного диска. ".repeat(20)}</p></article>
  </body></html>`;
  const article = extractArticle(html, "https://example.com/article");
  assert.match(article.title, /Как подобрать диски/);
  assert.match(article.text, /Полезный текст/);
  assert.doesNotMatch(article.text, /Главная Каталог Контакты/);
});

test("clamps a pagination offset beyond the article end", () => {
  assert.deepEqual(paginateText("abc", 10, 5), {
    text: "",
    totalCharacters: 3,
    startCharacter: 3,
    endCharacter: 3,
    truncated: false,
  });
});

test("fallback renders in the browser after an HTTP error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("Forbidden", {
    status: 403,
    headers: { "content-type": "text/html" },
  });
  let browserUsed = false;
  const browser = {
    installPublicWebGuard: async () => undefined,
    withPage: async (operation: (page: unknown) => Promise<unknown>) => {
      browserUsed = true;
      const response = {
        status: () => 200,
        headers: () => ({ "content-type": "text/html" }),
      };
      return await operation({
        goto: async () => response,
        waitForTimeout: async () => undefined,
        content: async () => "<html><head><title>Rendered</title></head><body><article>Rendered article</article></body></html>",
        url: () => "https://example.com/article",
      });
    },
  } as unknown as BrowserManager;
  const config: Config = {
    profileDir: "/tmp/unused-web-search-test-profile",
    headless: true,
    searchTimeoutMs: 1_000,
    fetchTimeoutMs: 1_000,
    fetchMaxBytes: 10_000,
    userAgent: "test",
  };
  try {
    const result = await readPage("https://example.com/article", browser, config, "fallback", 0, 1_000);
    assert.equal(result.error, undefined);
    assert.equal(result.fetchMode, "browser");
    assert.equal(browserUsed, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fallback does not retry an oversized HTTP body in the browser", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("x".repeat(100), {
    status: 200,
    headers: { "content-type": "text/html" },
  });
  let browserUsed = false;
  const browser = {
    withPage: async () => {
      browserUsed = true;
      throw new Error("browser must not be used");
    },
  } as unknown as BrowserManager;
  const config: Config = {
    profileDir: "/tmp/unused-web-search-test-profile",
    headless: true,
    searchTimeoutMs: 1_000,
    fetchTimeoutMs: 1_000,
    fetchMaxBytes: 10,
    userAgent: "test",
  };
  try {
    const result = await readPage("https://example.com/article", browser, config, "fallback", 0, 1_000);
    assert.match(result.error ?? "", /exceeds 10 bytes/);
    assert.equal(browserUsed, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sends Basic Auth only through HTTP fetching", async () => {
  const originalFetch = globalThis.fetch;
  let authorization: string | null = null;
  globalThis.fetch = async (_input, init) => {
    authorization = new Headers(init?.headers).get("authorization");
    return new Response("<html><body><article>Private article</article></body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  };
  let browserUsed = false;
  const browser = {
    withPage: async () => {
      browserUsed = true;
      throw new Error("browser must not be used for authenticated requests");
    },
  } as unknown as BrowserManager;
  const config: Config = {
    profileDir: "/tmp/unused-web-search-test-profile",
    headless: true,
    searchTimeoutMs: 1_000,
    fetchTimeoutMs: 1_000,
    fetchMaxBytes: 10_000,
    userAgent: "test",
  };
  try {
    const result = await readPage(
      "https://example.com/private",
      browser,
      config,
      "fallback",
      0,
      1_000,
      { username: "reader", password: "secret" },
    );
    assert.equal(result.error, undefined);
    assert.equal(authorization, "Basic cmVhZGVyOnNlY3JldA==");
    assert.equal(browserUsed, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not forward Basic Auth to a different redirect origin", async () => {
  const originalFetch = globalThis.fetch;
  const authorizations: Array<string | null> = [];
  globalThis.fetch = async (input, init) => {
    authorizations.push(new Headers(init?.headers).get("authorization"));
    const url = String(input);
    if (url.startsWith("https://example.com/")) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://example.org/article" },
      });
    }
    return new Response("<html><body><article>Redirected article</article></body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  };
  const browser = {} as BrowserManager;
  const config: Config = {
    profileDir: "/tmp/unused-web-search-test-profile",
    headless: true,
    searchTimeoutMs: 1_000,
    fetchTimeoutMs: 1_000,
    fetchMaxBytes: 10_000,
    userAgent: "test",
  };
  try {
    const result = await readPage(
      "https://example.com/private",
      browser,
      config,
      "never",
      0,
      1_000,
      { username: "reader", password: "secret" },
    );
    assert.equal(result.error, undefined);
    assert.deepEqual(authorizations, ["Basic cmVhZGVyOnNlY3JldA==", null]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects Basic Auth over plain HTTP", async () => {
  const originalFetch = globalThis.fetch;
  let fetchUsed = false;
  globalThis.fetch = async () => {
    fetchUsed = true;
    throw new Error("fetch must not be used");
  };
  const config: Config = {
    profileDir: "/tmp/unused-web-search-test-profile",
    headless: true,
    searchTimeoutMs: 1_000,
    fetchTimeoutMs: 1_000,
    fetchMaxBytes: 10_000,
    userAgent: "test",
  };
  try {
    const result = await readPage(
      "http://example.com/private",
      {} as BrowserManager,
      config,
      "never",
      0,
      1_000,
      { username: "reader", password: "secret" },
    );
    assert.match(result.error ?? "", /requires an HTTPS URL/);
    assert.equal(fetchUsed, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
