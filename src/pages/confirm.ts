import type { Page } from "playwright";
import type { ResolvedPatient } from "../config/load.js";
import { AlreadyBookedError, AppError, FullError, UnknownOutcomeError } from "../flow/errors.js";
import { phoneDigits } from "../fill/field-mapper.js";
import { CONFIRM } from "../site/selectors.js";
import { PATH } from "../site/urls.js";
import { squash } from "./business-top.js";
import { classifyModalText } from "./modal.js";
import { waitOutcome } from "./outcome.js";

const norm = (s: string) => s.replace(/[\s　]+/g, "");
const toHalf = (s: string) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/** 確認画面の表示内容が設定どおりか確かめ、表示テキストを返す */
export async function verifyConfirm(page: Page, patients: ResolvedPatient[], timeoutMs = 20_000): Promise<string> {
  await page.locator(CONFIRM.patients).first().waitFor({ state: "visible", timeout: timeoutMs });
  const guide = await page
    .locator(CONFIRM.guide)
    .first()
    .innerText()
    .catch(() => "");
  if (!CONFIRM.notYetText.test(guide)) {
    throw new AppError(`確認画面の表示が想定と違います: ${squash(guide)}`);
  }
  const lines: string[] = [];
  for (let i = 0; i < patients.length; i++) {
    const p = patients[i]!;
    const block = page.locator(CONFIRM.patientBlock(i + 1)).first();
    const text = (await block.count()) > 0 ? await block.innerText() : "";
    if (!norm(text).includes(norm(p.name))) {
      throw new AppError(`確認画面の ${i + 1} 人目に ${p.key} の氏名が見当たりません`);
    }
    // 電話番号は医院の必須項目なら表示される。表示されているのに一致しなければ止める
    const shown = toHalf(text).replace(/\D/g, "");
    const phone = phoneDigits(p.phone);
    if (/電話/.test(text) && !shown.includes(phone)) {
      throw new AppError(`確認画面の ${i + 1} 人目 (${p.key}) の電話番号が設定と一致しません`);
    }
    lines.push(squash(text));
  }
  return lines.join("\n");
}

/**
 * 「予約する」を 1 回だけ押し、完了画面への遷移を待つ。
 * 押した後は、結果がはっきりしない限り UnknownOutcomeError (再送しない)。
 */
export async function submitConfirm(page: Page, timeoutMs = 60_000, beforeClick?: () => void): Promise<void> {
  const btn = page.locator(CONFIRM.submit).first();
  await btn.waitFor({ state: "visible" });
  beforeClick?.();
  await btn.click({ noWaitAfter: true });
  const o = await waitOutcome(page, PATH.complete, timeoutMs);
  if (o.kind === "url") return;
  if (o.kind === "modal") {
    switch (classifyModalText(o.text)) {
      case "full":
        throw new FullError(`予約できませんでした (満枠・受付終了): ${o.text}`);
      case "already":
        throw new AlreadyBookedError(`予約できませんでした (既に予約あり): ${o.text}`);
      case "session":
        throw new AppError(`セッション切れで予約されませんでした。やり直してください: ${o.text}`);
      case "transient":
        throw new UnknownOutcomeError(`予約ボタン押下後に通信エラー。予約できたか手動で確認してください: ${o.text}`);
      default:
        throw new UnknownOutcomeError(
          `予約ボタン押下後にメッセージが出ました。予約状況を手動で確認してください: ${o.text}`,
        );
    }
  }
  throw new UnknownOutcomeError("予約ボタン押下後、完了画面に進みませんでした。予約できたか手動で確認してください");
}
