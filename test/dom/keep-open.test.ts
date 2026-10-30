import type { Browser, BrowserContext, Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { waitForClose } from "../../src/browser/keep-open.js";
import { launch, newPage } from "./helpers.js";

let browser: Browser;
let context: BrowserContext;
let page: Page;

beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser.close();
});
beforeEach(async () => {
  ({ context, page } = await newPage(browser));
});
afterEach(async () => {
  await context.close();
});

/** 一定時間待っても解決しなければ "pending" */
const settled = (p: Promise<void>): Promise<"done" | "pending"> =>
  Promise.race([p.then(() => "done" as const), new Promise<"pending">((r) => setTimeout(() => r("pending"), 300))]);

describe("waitForClose", () => {
  it("ページが開いている間は待ち続け、閉じると解決する", async () => {
    const w = waitForClose(page);
    expect(await settled(w)).toBe("pending");
    await page.close();
    await expect(w).resolves.toBeUndefined();
  });

  it("コンテキスト (ウィンドウ) ごと閉じても解決する", async () => {
    const w = waitForClose(page);
    await context.close();
    await expect(w).resolves.toBeUndefined();
  });

  it("signal が abort されると解決する (Ctrl-C 相当)", async () => {
    const ac = new AbortController();
    const w = waitForClose(page, ac.signal);
    expect(await settled(w)).toBe("pending");
    ac.abort();
    await expect(w).resolves.toBeUndefined();
    expect(page.isClosed()).toBe(false);
  });

  it("すでに閉じているページなら即解決する", async () => {
    await page.close();
    await expect(waitForClose(page)).resolves.toBeUndefined();
  });
});
