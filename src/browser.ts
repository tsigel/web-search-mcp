import { mkdir } from "node:fs/promises";
import { chromium, type BrowserContext, type Page, type Route } from "playwright-core";
import type { Config } from "./config.js";
import { assertPublicHttpUrl } from "./security.js";

export class BrowserManager {
  private contextPromise: Promise<BrowserContext> | undefined;

  constructor(private readonly config: Config) {}

  private async context(): Promise<BrowserContext> {
    this.contextPromise ??= this.launch().catch((error) => {
      this.contextPromise = undefined;
      throw error;
    });
    return await this.contextPromise;
  }

  private async launch(): Promise<BrowserContext> {
    await mkdir(this.config.profileDir, { recursive: true, mode: 0o700 });
    return await chromium.launchPersistentContext(this.config.profileDir, {
      ...(this.config.chromePath ? { executablePath: this.config.chromePath } : { channel: "chrome" }),
      headless: this.config.headless,
      locale: "ru-RU",
      viewport: { width: 1365, height: 900 },
    });
  }

  async withPage<T>(operation: (page: Page) => Promise<T>): Promise<T> {
    const context = await this.context();
    const page = await context.newPage();
    page.setDefaultTimeout(this.config.searchTimeoutMs);
    page.setDefaultNavigationTimeout(this.config.searchTimeoutMs);
    try {
      return await operation(page);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async installPublicWebGuard(page: Page): Promise<void> {
    await page.route("**/*", async (route: Route) => {
      const request = route.request();
      if (["image", "media", "font", "stylesheet"].includes(request.resourceType())) {
        await route.abort();
        return;
      }
      const raw = request.url();
      if (raw.startsWith("data:") || raw.startsWith("blob:") || raw === "about:blank") {
        await route.continue();
        return;
      }
      try {
        await assertPublicHttpUrl(raw);
        await route.continue();
      } catch {
        await route.abort("blockedbyclient");
      }
    });
  }

  async close(): Promise<void> {
    const context = await this.contextPromise?.catch(() => undefined);
    this.contextPromise = undefined;
    await context?.close();
  }
}
