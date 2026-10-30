import type { Page } from "playwright";

/**
 * ページ (タブ・ウィンドウ) かブラウザが閉じられる、または signal が abort されるまで待つ。
 * 確認画面でブラウザを残し、ユーザーに手動で操作してもらうために使う。
 */
export function waitForClose(page: Page, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (page.isClosed() || signal?.aborted) return resolve();
    const browser = page.context().browser();
    const done = () => {
      page.off("close", done);
      browser?.off("disconnected", done);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    page.once("close", done);
    browser?.once("disconnected", done);
    signal?.addEventListener("abort", done, { once: true });
  });
}
