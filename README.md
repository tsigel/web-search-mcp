# web-search-mcp

Локальный MCP-сервер с двумя инструментами:

- `web_search` — поиск в Яндексе или Google через отдельный постоянный Chrome-профиль;
- `read_pages` — чтение до 10 URL из публичного веба, извлечение основного текста и метаданных статьи.

По умолчанию браузер видимый (`WEB_SEARCH_HEADLESS=false`), запускается только при первом поиске или browser fallback. Stealth-плагины, прокси-ротация и автоматическое решение CAPTCHA не используются. Для ручного решения CAPTCHA передайте ненулевой `operatorWaitSeconds` в том же вызове и решите её в открытом Chrome до дедлайна: инструмент продолжит текущий запрос автоматически. Повторять запрос нужно только после timeout или возвращённой ошибки.

## Почему только два инструмента

Это общая минимальная поверхность зрелых web MCP: Exa использует search/fetch, Tavily — search/extract, Bright Data — search/scrape. Пакетное чтение URL включено в `read_pages`, чтобы локальная медленная модель делала меньше tool-вызовов.

## Установка

```bash
npm install
npm run build
```

Требуются Node.js 24+ и установленный Google Chrome. Для другого Chromium задайте `WEB_SEARCH_CHROME_PATH`.

Пример stdio-конфигурации MCP-клиента:

```json
{
  "mcpServers": {
    "web-search": {
      "command": "node",
      "args": ["/absolute/path/to/web-search-mcp/dist/src/server.js"],
      "env": {
        "WEB_SEARCH_HEADLESS": "false",
        "WEB_SEARCH_PROFILE_DIR": "/absolute/path/to/chrome-profile"
      }
    }
  }
}
```

Профиль должен быть отдельным: Playwright не поддерживает автоматизацию основного пользовательского профиля Chrome и Chrome не разрешает одновременно открыть один профиль двумя процессами.

## Контракт

### `web_search`

Параметры:

- `query` — запрос;
- `engine` — `yandex` (по умолчанию), `google` или `auto`;
- `limit` — 1–20;
- `page` — номер страницы с нуля.
- `operatorWaitSeconds` — в headed-режиме оставить CAPTCHA открытой до 300 секунд для ручного решения.

`auto` сначала пробует Яндекс, затем Google, если Яндекс заблокирован или не вернул результатов. Headless-запросы обоих поисковиков могут сразу получить CAPTCHA; рабочий локальный сценарий — headed-профиль и ненулевой `operatorWaitSeconds` при необходимости.

### `read_pages`

Параметры:

- `urls` — 1–10 HTTP(S) URL из публичного веба; denylist остаётся best-effort проверкой, а не гарантией сетевой изоляции;
- `render` — `fallback` (по умолчанию), `never` или `always`;
- `maxCharactersPerPage` — до 50 000 символов;
- `startCharacter` — продолжение длинной страницы с указанной позиции.

Сначала выполняется обычный HTTP-запрос. При HTTP-ошибке или слишком коротком результате режим `fallback` рендерит страницу в Chrome. localhost, известные приватные адреса, нестандартные порты, слишком большие ответы и небезопасные редиректы отклоняются best-effort denylist-ом. Это защита от случайных обращений, а не полноценная SSRF-граница: MCP следует запускать только в доверенной локальной среде без доступа к чувствительным внутренним сервисам.

## Проверки

```bash
npm test
npm run typecheck
npm run build
npm run smoke -- list
npm run smoke -- read
npm run smoke -- search УАЗ Патриот заводской вылет диска
```

Live-поиск намеренно не входит в автоматические тесты: выдача и CAPTCHA нестабильны. Его следует проверять отдельно через MCP Inspector или фактический клиент.
