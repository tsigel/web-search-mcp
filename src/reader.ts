import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import type { Config } from "./config.js";
import type { BrowserManager } from "./browser.js";
import { assertPublicHttpUrl } from "./security.js";

export type RenderMode = "never" | "fallback" | "always";

export interface BasicAuth {
  username: string;
  password: string;
}

export interface ReadPageResult {
  url: string;
  finalUrl?: string;
  status?: number;
  contentType?: string;
  title?: string;
  byline?: string | null;
  siteName?: string | null;
  publishedTime?: string | null;
  excerpt?: string;
  text?: string;
  totalCharacters?: number;
  startCharacter?: number;
  endCharacter?: number;
  truncated?: boolean;
  nextStartCharacter?: number;
  fetchMode?: "http" | "browser";
  error?: string;
}

interface ExtractedArticle {
  title: string;
  byline: string | null;
  siteName: string | null;
  publishedTime: string | null;
  excerpt: string;
  text: string;
}

class PageTooLargeError extends Error {}

export function paginateText(text: string, requestedStart: number, maxCharacters: number): {
  text: string;
  totalCharacters: number;
  startCharacter: number;
  endCharacter: number;
  truncated: boolean;
  nextStartCharacter?: number;
} {
  const totalCharacters = text.length;
  const startCharacter = Math.min(requestedStart, totalCharacters);
  const endCharacter = Math.min(totalCharacters, startCharacter + maxCharacters);
  const truncated = endCharacter < totalCharacters;
  return {
    text: text.slice(startCharacter, endCharacter),
    totalCharacters,
    startCharacter,
    endCharacter,
    truncated,
    ...(truncated ? { nextStartCharacter: endCharacter } : {}),
  };
}

function normalizeText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function extractArticle(html: string, url: string): ExtractedArticle {
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;
  const fallbackTitle = document.title;
  const fallbackText = normalizeText(document.body?.textContent ?? "");
  const article = new Readability(document.cloneNode(true) as Document, {
    maxElemsToParse: 100_000,
    charThreshold: 200,
  }).parse();
  return {
    title: normalizeText(article?.title ?? fallbackTitle),
    byline: article?.byline ?? null,
    siteName: article?.siteName ?? null,
    publishedTime: article?.publishedTime ?? null,
    excerpt: normalizeText(article?.excerpt ?? ""),
    text: normalizeText(article?.textContent || fallbackText),
  };
}

async function readLimitedBody(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel();
      throw new PageTooLargeError(`Page exceeds ${limit} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function fetchHtml(rawUrl: string, config: Config, basicAuth?: BasicAuth): Promise<{
  html: string;
  finalUrl: string;
  status: number;
  contentType: string;
}> {
  let url = await assertPublicHttpUrl(rawUrl);
  if (basicAuth && url.protocol !== "https:") {
    throw new Error("Basic Auth requires an HTTPS URL");
  }
  const authenticatedOrigin = basicAuth ? url.origin : undefined;
  const authorization = basicAuth
    ? `Basic ${Buffer.from(`${basicAuth.username}:${basicAuth.password}`, "utf8").toString("base64")}`
    : undefined;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(config.fetchTimeoutMs),
      headers: {
        "User-Agent": config.userAgent,
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
        "Accept-Language": "ru,en;q=0.7",
        ...(authorization && url.origin === authenticatedOrigin ? { Authorization: authorization } : {}),
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirect ${response.status} has no Location header`);
      url = await assertPublicHttpUrl(new URL(location, url).href);
      continue;
    }
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!contentType.startsWith("text/html")
      && contentType !== "application/xhtml+xml"
      && !contentType.startsWith("text/plain")) {
      throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return {
      html: await readLimitedBody(response, config.fetchMaxBytes),
      finalUrl: url.href,
      status: response.status,
      contentType,
    };
  }
  throw new Error("Too many redirects");
}

async function renderHtml(rawUrl: string, browser: BrowserManager, config: Config): Promise<{
  html: string;
  finalUrl: string;
  status?: number;
  contentType: string;
}> {
  const url = await assertPublicHttpUrl(rawUrl);
  return await browser.withPage(async (page) => {
    await browser.installPublicWebGuard(page);
    const response = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: config.fetchTimeoutMs });
    await page.waitForTimeout(500);
    const html = await page.content();
    if (new TextEncoder().encode(html).byteLength > config.fetchMaxBytes) {
      throw new PageTooLargeError(`Rendered page exceeds ${config.fetchMaxBytes} bytes`);
    }
    return {
      html,
      finalUrl: page.url(),
      ...(response ? { status: response.status() } : {}),
      contentType: response?.headers()["content-type"] ?? "text/html",
    };
  });
}

export async function readPage(
  rawUrl: string,
  browser: BrowserManager,
  config: Config,
  render: RenderMode,
  startCharacter: number,
  maxCharacters: number,
  basicAuth?: BasicAuth,
): Promise<ReadPageResult> {
  try {
    if (basicAuth && render === "always") {
      throw new Error("Basic Auth is supported only by HTTP fetching; render=always is not allowed");
    }
    let loaded: Awaited<ReturnType<typeof fetchHtml>> | Awaited<ReturnType<typeof renderHtml>>;
    let fetchMode: "http" | "browser";
    if (render === "always") {
      loaded = await renderHtml(rawUrl, browser, config);
      fetchMode = "browser";
    } else {
      try {
        loaded = await fetchHtml(rawUrl, config, basicAuth);
        fetchMode = "http";
        if (!basicAuth && render === "fallback" && extractArticle(loaded.html, loaded.finalUrl).text.length < 1_000) {
          loaded = await renderHtml(rawUrl, browser, config);
          fetchMode = "browser";
        }
      } catch (httpError) {
        if (basicAuth || render !== "fallback" || httpError instanceof PageTooLargeError) throw httpError;
        loaded = await renderHtml(rawUrl, browser, config);
        fetchMode = "browser";
      }
    }
    const article = extractArticle(loaded.html, loaded.finalUrl);
    const page = paginateText(article.text, startCharacter, maxCharacters);
    return {
      url: rawUrl,
      finalUrl: loaded.finalUrl,
      ...(loaded.status !== undefined ? { status: loaded.status } : {}),
      contentType: loaded.contentType,
      title: article.title,
      byline: article.byline,
      siteName: article.siteName,
      publishedTime: article.publishedTime,
      excerpt: article.excerpt,
      ...page,
      fetchMode,
    };
  } catch (error) {
    return { url: rawUrl, error: error instanceof Error ? error.message : String(error) };
  }
}
