import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext } from "playwright";
import { Artifacts } from "../browser/artifacts.js";
import { closeContext, launchBrowser, newBookingContext } from "../browser/session.js";
import { loadConfig, resolveClinic } from "../config/load.js";
import { AppError } from "../flow/errors.js";
import { openBusinessTop, readBusinessTop } from "../pages/business-top.js";
import { openNewBooking, readFrames } from "../pages/new-booking.js";
import { businessTopUrl } from "../site/urls.js";

export interface StatusOptions {
  config: string;
  clinic?: string;
  saveFixture?: boolean;
  headed?: boolean;
}

/** 読み取りのみ: 診療状態と (受付中なら) 当日枠一覧を表示する。入力・予約は一切しない */
export async function status(o: StatusOptions): Promise<void> {
  const cfg = loadConfig(o.config);
  const { clinicKey, clinic } = resolveClinic(cfg, o.clinic);
  const art = new Artifacts();
  const session = { ...cfg.browser, headless: o.headed ? false : cfg.browser.headless };
  const browser = await launchBrowser(session);
  try {
    const ctx = await newBookingContext(browser, session);
    try {
      await run(ctx);
    } finally {
      await closeContext(ctx);
    }
  } finally {
    await browser.close();
  }

  async function run(ctx: BrowserContext): Promise<void> {
    const page = await ctx.newPage();
    const out: string[] = [`${clinicKey}: ${businessTopUrl(clinic)}`];
    await openBusinessTop(page, clinic);
    const top = await readBusinessTop(page);
    out.push(
      `医院: ${top.clinicName} / ${top.businessName}`,
      `予約方式: ${{ order: "順番予約", timezone: "時間帯予約", unknown: "不明" }[top.mode]}`,
      `状態: ${top.nonService ?? "受付中の可能性あり"}`,
      `予約へリンク: ${top.hasBookLink ? "あり" : "なし"}`,
      `待ち状況: ${top.situation}`,
    );
    await art.capture(page, "top");
    if (o.saveFixture) writeFileSync(join(art.dir, "fixture-top.html"), await page.content());

    if (top.hasBookLink && !top.nonService) {
      try {
        await openNewBooking(page, clinic, cfg.browser.timeout_ms);
        const frames = await readFrames(page);
        out.push("当日枠:");
        for (const f of frames) {
          out.push(`  - ${f.name} ${f.wait} ${f.bookable ? "○ 予約可" : "×"}${f.outOfPeriod ? " (予約可能時間外)" : ""}${f.message ? ` ${f.message}` : ""}`);
        }
        await art.capture(page, "frames");
        if (o.saveFixture) writeFileSync(join(art.dir, "fixture-frames.html"), await page.content());
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        out.push(`当日枠: ${e.message}`);
      }
    }
    console.log(out.join("\n"));
    art.log(`記録先: ${art.dir}${o.saveFixture ? " (fixture-*.html は個人情報がないことを確認してから test/fixtures へ)" : ""}`);
  }
}
