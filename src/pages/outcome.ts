import type { Page } from "playwright";
import { ERROR_MODAL } from "../site/selectors.js";
import { pathOf } from "../site/urls.js";
import { readErrorModal } from "./modal.js";

export type Outcome =
  | { kind: "url" }
  | { kind: "modal"; text: string }
  | { kind: "extra"; name: string }
  | { kind: "timeout" };

/**
 * 操作後、目的の URL への遷移・エラーモーダル・追加で監視するセレクタのどれが先に起きるかを待つ。
 * URL はクライアント遷移 (router.push) なので pathname をポーリングで見る。
 */
export async function waitOutcome(
  page: Page,
  target: RegExp,
  timeoutMs: number,
  extra: Record<string, string> = {},
): Promise<Outcome> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (target.test(pathOf(page.url()))) return { kind: "url" };
    if (
      await page
        .locator(ERROR_MODAL.root)
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      // 本文の描画を少し待つ
      await page.waitForTimeout(200);
      return { kind: "modal", text: (await readErrorModal(page)) ?? "(本文なし)" };
    }
    for (const [name, sel] of Object.entries(extra)) {
      if (
        await page
          .locator(sel)
          .first()
          .isVisible()
          .catch(() => false)
      )
        return { kind: "extra", name };
    }
    await page.waitForTimeout(150);
  }
  return { kind: "timeout" };
}
