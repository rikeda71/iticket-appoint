import type { Page } from "playwright";
import { AlreadyBookedError, AppError, FullError, NotOpenError } from "../flow/errors.js";
import { ERROR_MODAL } from "../site/selectors.js";

/**
 * 予約処理中に出るエラーモーダルの文言はサーバー応答そのまま (クライアントに定義なし) なので、
 * キーワードでおおまかに分類する。
 *  - retry: 受付前・セッション切れ・一時的な通信エラー (送信前なら再試行してよい)
 *  - full / already: 再試行しても成功しない
 *  - transient: 通信系。送信後に出た場合は結果不明扱い
 */
export type ModalKind = "session" | "notOpen" | "full" | "already" | "transient" | "other";

export function classifyModalText(text: string): ModalKind {
  if (/時間が経って|トップページからやり直/.test(text)) return "session";
  if (/サーバーエラー|通信エラー|時間を(開|空)けて/.test(text)) return "transient";
  if (/既に|すでに|重複|同一の?(患者|方)/.test(text)) return "already";
  // 「受付時間外のため受付できません」を満枠と誤認しないよう notOpen を先に判定する
  if (/(受付|予約)(可能な)?時間(外|ではありません)|受付(開始)?前|まだ.*(受付|開始)|時間外/.test(text)) return "notOpen";
  if (/満員|満枠|満了|上限|定員|人数制限|受付(を|は)?終了|締め?切|受付できません|空きがありません/.test(text)) return "full";
  return "other";
}

/** 送信前のモーダルを例外に変換する */
export function modalError(text: string): AppError {
  switch (classifyModalText(text)) {
    case "session":
    case "notOpen":
    case "transient":
      return new NotOpenError(`サイトのメッセージ: ${text}`);
    case "full":
      return new FullError(`満枠・受付終了: ${text}`);
    case "already":
      return new AlreadyBookedError(`既に予約があります: ${text}`);
    default:
      return new AppError(`サイトのメッセージ: ${text}`);
  }
}

/** 表示中のエラーモーダルの本文。なければ undefined */
export async function readErrorModal(page: Page): Promise<string | undefined> {
  const root = page.locator(ERROR_MODAL.root);
  if (!(await root.first().isVisible().catch(() => false))) return undefined;
  const text = await root.locator(ERROR_MODAL.body).first().innerText().catch(() => "");
  return text.replace(/\s+/g, " ").trim() || "(本文なし)";
}

export async function closeErrorModal(page: Page): Promise<void> {
  await page.locator(ERROR_MODAL.close).first().click({ timeout: 3000 }).catch(() => undefined);
}
