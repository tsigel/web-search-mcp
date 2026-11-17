import assert from "node:assert/strict";
import test from "node:test";
import { isSearchBlockedPage, parseSearchHtml } from "../src/search.js";

test("parses Yandex organic results and removes duplicates", () => {
  const html = `
    <ul>
      <li class="serp-item"><h2><a class="OrganicTitle-Link" href="https://example.com/a"><span class="OrganicTitle-LinkText">Статья A</span></a></h2><div class="OrganicTextContentSpan">Описание A</div></li>
      <li class="serp-item"><h2><a class="OrganicTitle-Link" href="https://example.com/a"><span class="OrganicTitle-LinkText">Дубль</span></a></h2></li>
      <li class="serp-item"><h2><a class="OrganicTitle-Link" href="https://example.org/b"><span class="OrganicTitle-LinkText">Статья B</span></a></h2></li>
    </ul>`;
  assert.deepEqual(parseSearchHtml("yandex", html, "https://yandex.ru/search/?text=x", 10), [
    { rank: 1, title: "Статья A", url: "https://example.com/a", snippet: "Описание A" },
    { rank: 2, title: "Статья B", url: "https://example.org/b", snippet: "" },
  ]);
});

test("parses Google result links", () => {
  const html = `<div><a href="https://example.com/page"><h3>Example title</h3></a><div>Useful snippet</div></div>`;
  const results = parseSearchHtml("google", html, "https://www.google.com/search?q=x", 10);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.url, "https://example.com/page");
  assert.equal(results[0]?.title, "Example title");
});

test("does not classify an ordinary CAPTCHA article search as a block page", () => {
  assert.equal(isSearchBlockedPage(
    "https://yandex.ru/search/?text=captcha",
    "captcha — Яндекс: нашлось 2 млн результатов",
    "Что такое CAPTCHA — статья и документация",
  ), false);
});

test("detects dedicated CAPTCHA pages by URL, controls and block message", () => {
  assert.equal(isSearchBlockedPage("https://yandex.ru/showcaptcha", "", ""), true);
  assert.equal(isSearchBlockedPage("https://google.com/search", "", "", true), true);
  assert.equal(isSearchBlockedPage(
    "https://google.com/search",
    "Google",
    "Our systems have detected unusual traffic from your computer network",
  ), true);
});
