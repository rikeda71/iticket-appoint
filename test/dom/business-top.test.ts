import type { Browser, BrowserContext, Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readBusinessTop } from "../../src/pages/business-top.js";
import { fixture, launch, newPage, serveHtml } from "./helpers.js";

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

const closed = fixture("business-top-closed.html");

describe("readBusinessTop (実ページ由来: 診察時間外)", () => {
  it("医院名・診療名・順番予約モード・時間外・予約リンクを読む", async () => {
    await serveHtml(page, closed, "/park2/clinics/2171/businesses/01");
    const top = await readBusinessTop(page);
    expect(top.clinicName).toBe("竹田耳鼻咽喉科クリニック");
    expect(top.businessName).toBe("診察");
    expect(top.mode).toBe("order");
    expect(top.nonService).toBe("診察時間外");
    expect(top.hasBookLink).toBe(true);
    expect(top.situation).toContain("診察時間外");
    expect(top.situation).not.toContain("\n");
  });

  it("時間帯予約 (.ipk-view-situation-w) は timezone", async () => {
    const html = closed.replace('class="ipk-view-situation-j"', 'class="ipk-view-situation-w"');
    await serveHtml(page, html, "/park2/clinics/2171/businesses/01");
    expect((await readBusinessTop(page)).mode).toBe("timezone");
  });

  it("待ち状況パネルがなければ unknown", async () => {
    // 本番では BrowserContext.setDefaultTimeout(timeout_ms) が掛かる。h2 が無いと evaluate がそれだけ待つ
    page.setDefaultTimeout(1000);
    await serveHtml(page, "<div><h1 class='ipk-page-title-main'>X</h1></div>", "/park2/clinics/2171/businesses/01");
    const top = await readBusinessTop(page);
    expect(top.mode).toBe("unknown");
    expect(top.situation).toBe("");
    expect(top.hasBookLink).toBe(false);
    expect(top.nonService).toBeUndefined();
  });

  it("受付中 (non-service なし) は nonService を持たない", async () => {
    const html = closed.replace(/<section class="ipk-non-service">.*?<\/section>/, "");
    await serveHtml(page, html, "/park2/clinics/2171/businesses/01");
    const top = await readBusinessTop(page);
    expect(top.nonService).toBeUndefined();
    expect("nonService" in top).toBe(false);
    expect(top.mode).toBe("order");
    expect(top.hasBookLink).toBe(true);
  });

  it("予約リンクがなければ hasBookLink=false", async () => {
    const html = closed.replace(/<section class="ipk-gmtp-to-book">.*?<\/section>/, "");
    await serveHtml(page, html, "/park2/clinics/2171/businesses/01");
    expect((await readBusinessTop(page)).hasBookLink).toBe(false);
  });
});
