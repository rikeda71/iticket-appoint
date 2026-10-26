import type { Page } from "playwright";
import { COMPLETE } from "../site/selectors.js";
import { squash } from "./business-top.js";

export interface CompleteInfo {
  acceptNo?: string;
  text: string;
}

export function extractAcceptNo(text: string): string | undefined {
  return COMPLETE.acceptNo.exec(text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)))?.[1];
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
