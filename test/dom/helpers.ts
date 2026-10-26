import { readFileSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { ResolvedPatient } from "../../src/config/load.js";

export const HOST = "http://localhost.test";
export const BASE = `${HOST}/park2/clinics/1/businesses/01`;

export const fixture = (name: string): string => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

export interface Env {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export const launch = (): Promise<Browser> => chromium.launch({ headless: true });

/** 外部ネットワークに出ないよう、全リクエストを遮断した新しい page */
export async function newPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ locale: "ja-JP" });
  await context.route("**/*", (r) => r.abort());
  return { context, page: await context.newPage() };
}

/** 擬似 URL (http://localhost.test/...) に HTML を返すようにして goto する。pushState が使える */
export async function serveHtml(
  page: Page,
  html: string,
  path = "/park2/clinics/1/businesses/01/bookings/new",
): Promise<void> {
  await page.route(`${HOST}/**`, (r) =>
    r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }),
  );
  await page.goto(`${HOST}${path}`, { waitUntil: "domcontentloaded" });
}

export const patient = (key = "taro", over: Partial<ResolvedPatient> = {}): ResolvedPatient => ({
  key,
  name: "山田 太郎",
  name_kana: "ヤマダ タロウ",
  patient_card_no: "12345",
  birth: "1990-01-02",
  phone: "090-1234-5678",
  sex: "male",
  new_patient: false,
  custom_fields: { 症状: "鼻水", アレルギー: "花粉,卵" },
  ...over,
});
