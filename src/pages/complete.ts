import type { Page } from "playwright";
import { COMPLETE } from "../site/selectors.js";
import { squash } from "./business-top.js";

export interface CompleteInfo {
  acceptNo?: string;
  text: string;
}

/**
 * 完了画面のテキストから受付番号を探す。実画面の文言は未確認なので、
 * 「受付番号」「予約番号」「整理番号」「あなたの順番」などのラベルの直後の数字 (全角・改行区切り・「12番」も可) を
 * ラベルの優先順に探し、最後に単独の「番号」、「予約は 12番です」の形を試す。
 * 日付・電話番号・診察券番号などは拾わない。
 */
export function extractAcceptNo(text: string): string | undefined {
  const t = text.normalize("NFKC");
  for (const label of COMPLETE.acceptNoLabels) {
    for (const m of t.matchAll(new RegExp(label.source, label.flags.includes("g") ? label.flags : `${label.flags}g`))) {
      const v = COMPLETE.acceptNoValue.exec(t.slice(m.index + m[0].length))?.[1];
      if (v) return v;
    }
  }
  return COMPLETE.acceptNoBan.exec(t)?.[1];
}

/** 完了画面のテキストと受付番号 (見つかれば) */
export async function readComplete(page: Page): Promise<CompleteInfo> {
  const main = page.locator(COMPLETE.main).first();
  // 描画待ち (DOM 未確認のため、本文が出るまで少し待つ)
  await main.waitFor({ state: "visible" }).catch(() => undefined);
  await page.waitForTimeout(1000);
  const raw = (await main.count()) > 0 ? await main.innerText() : await page.locator("body").innerText();
  const acceptNo = extractAcceptNo(raw);
  return { ...(acceptNo ? { acceptNo } : {}), text: squash(raw) };
}
