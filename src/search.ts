import { JSDOM } from "jsdom";
import type { Config } from "./config.js";
import type { BrowserManager } from "./browser.js";

export type SearchEngine = "yandex" | "google";

export interface SearchResult {
  rank: number;
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  engine: SearchEngine;
  query: string;
  page: number;
  results: SearchResult[];
}

export class SearchBlockedError extends Error {
  constructor(readonly engine: SearchEngine, message: string) {
    super(message);
  }
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function externalUrl(raw: string, base: string, engine: SearchEngine): string | undefined {
  try {
    const url = new URL(raw, base);
    if (engine === "google" && url.pathname === "/url") {
      const target = url.searchParams.get("q") ?? url.searchParams.get("url");
      if (target) return externalUrl(target, base, engine);
    }
    if (engine === "yandex" && url.hostname.endsWith("yandex.ru")) {
      const target = url.searchParams.get("url") ?? url.searchParams.get("target");
      if (target) return externalUrl(target, base, engine);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    const internal = engine === "google"
      ? /(^|\.)google\./.test(url.hostname)
      : /(^|\.)yandex\./.test(url.hostname);
    return internal ? undefined : url.href;
  } catch {
    return undefined;
  }
}

export function parseSearchHtml(engine: SearchEngine, html: string, baseUrl: string, limit: number): SearchResult[] {
  const document = new JSDOM(html, { url: baseUrl }).window.document;
  const candidates = engine === "yandex"
    ? [...document.querySelectorAll(".serp-item, li[data-cid], [data-fast-name='entity']")]
    : [...document.querySelectorAll("a:has(h3)")];
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const link = engine === "yandex"
      ? candidate.querySelector<HTMLAnchorElement>("a.OrganicTitle-Link, .OrganicTitle a, h2 a, a[href]")
      : (candidate instanceof document.defaultView!.HTMLAnchorElement
          ? candidate
          : candidate.querySelector<HTMLAnchorElement>("a[href]"));
    const titleElement = engine === "yandex"
      ? candidate.querySelector(".OrganicTitle-LinkText, h2, h3")
      : candidate.querySelector("h3");
    const url = link ? externalUrl(link.getAttribute("href") ?? "", baseUrl, engine) : undefined;
    const title = clean(titleElement?.textContent ?? link?.textContent);
    if (!url || !title || seen.has(url)) continue;
    const snippet = engine === "yandex"
      ? clean(candidate.querySelector(".OrganicTextContentSpan, .Organic-Text, .text-container, [class*='Snippet']")?.textContent)
      : clean(candidate.parentElement?.parentElement?.textContent?.replace(title, ""));
    seen.add(url);
    results.push({ rank: results.length + 1, title, url, snippet: snippet.slice(0, 1_000) });
    if (results.length >= limit) break;
  }
  return results;
}

function searchUrl(engine: SearchEngine, query: string, page: number, limit: number): string {
  if (engine === "yandex") {
    const url = new URL("https://yandex.ru/search/");
    url.searchParams.set("text", query);
    url.searchParams.set("p", String(page));
    return url.href;
  }
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("start", String(page * 10));
  url.searchParams.set("num", String(Math.min(10, limit)));
  url.searchParams.set("hl", "ru");
  return url.href;
}

export function isSearchBlockedPage(
  url: string,
  title: string,
  body: string,
  hasCaptchaControls = false,
): boolean {
  return /showcaptcha|\/sorry\//i.test(url)
    || hasCaptchaControls
    || /^(captcha|access denied|доступ ограничен|ой!|подтверждение)$/i.test(title.trim())
    || /unusual traffic from your computer network|введите символы с картинки|подтвердите.{0,30}(не )?робот|обнаружены автоматические запросы/i.test(body.slice(0, 4_000));
}

export async function search(
  browser: BrowserManager,
  config: Config,
  engine: SearchEngine,
  query: string,
  pageNumber: number,
  limit: number,
  operatorWaitSeconds: number,
): Promise<SearchResponse> {
  return await browser.withPage(async (page) => {
    const target = searchUrl(engine, query, pageNumber, limit);
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: config.searchTimeoutMs });
    await page.waitForTimeout(800);
    let [html, body, title] = await Promise.all([
      page.content(),
      page.locator("body").innerText({ timeout: 5_000 }).catch(() => ""),
      page.title(),
    ]);
    let hasCaptchaControls = await page.locator(
      "form[action*='captcha'], iframe[src*='recaptcha'], iframe[src*='smartcaptcha'], [class*='Captcha'], [id*='captcha']",
    ).count().then((count) => count > 0).catch(() => false);
    if (isSearchBlockedPage(page.url(), title, body, hasCaptchaControls)) {
      if (operatorWaitSeconds > 0 && !config.headless) {
        const deadline = Date.now() + operatorWaitSeconds * 1_000;
        while (Date.now() < deadline && isSearchBlockedPage(page.url(), title, body, hasCaptchaControls)) {
          await page.waitForTimeout(1_000);
          [html, body, title] = await Promise.all([
            page.content(),
            page.locator("body").innerText({ timeout: 5_000 }).catch(() => ""),
            page.title(),
          ]);
          hasCaptchaControls = await page.locator(
            "form[action*='captcha'], iframe[src*='recaptcha'], iframe[src*='smartcaptcha'], [class*='Captcha'], [id*='captcha']",
          ).count().then((count) => count > 0).catch(() => false);
        }
      }
      if (isSearchBlockedPage(page.url(), title, body, hasCaptchaControls)) {
        throw new SearchBlockedError(
          engine,
          `${engine} requested CAPTCHA or blocked automated access; use headed mode with operatorWaitSeconds to solve it manually`,
        );
      }
    }
    return {
      engine,
      query,
      page: pageNumber,
      results: parseSearchHtml(engine, html, page.url(), limit),
    };
  });
}
