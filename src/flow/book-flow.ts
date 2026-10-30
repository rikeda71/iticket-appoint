import { join } from "node:path";
import type { Browser, Page } from "playwright";
import type { ResolvedPatient } from "../config/load.js";
import type { Clinic } from "../config/schema.js";
import type { Artifacts } from "../browser/artifacts.js";
import { closeContext, newBookingContext, type SessionOptions } from "../browser/session.js";
import { readComplete } from "../pages/complete.js";
import { submitConfirm, verifyConfirm } from "../pages/confirm.js";
import { fillInputAndProceed } from "../pages/input.js";
import {
  chooseFrame,
  goToInput,
  openNewBooking,
  readFrames,
  selectTodayAndCount,
  type FrameInfo,
} from "../pages/new-booking.js";
import { AlreadyBookedError, AppError, FullError, NotOpenError, UnknownOutcomeError } from "./errors.js";

export interface BookParams {
  clinic: Clinic;
  patients: ResolvedPatient[];
  /** 枠名の部分一致 */
  frame?: string;
  submit: boolean;
  session: SessionOptions;
  artifacts: Artifacts;
  /** 「予約する」を押す直前に呼ぶ (送信済みの記録用) */
  onSubmit?: () => void;
  /** お試しで確認画面に着いたあと、結果を返す前に呼ぶ (--keep-open でブラウザを残して待つ用)。コンテキストはこの間開いたまま */
  onConfirm?: (page: Page) => Promise<void>;
}

export type BookResult =
  | { kind: "dry-run"; frame: FrameInfo; confirmText: string; screenshot?: string }
  | { kind: "booked"; frame: FrameInfo; acceptNo?: string; text: string; screenshot?: string };

/**
 * 予約 1 回分 (/bookings/new → 枠 → 入力 → 確認 → [予約する → 完了])。
 * 枠選択までのブラウザ由来のエラー (タイムアウト・通信) は NotOpenError にして待機モードで再試行させる。
 * 入力画面以降のブラウザ由来のエラーは画面構成の想定違いの可能性が高いので再試行しない。
 * 送信後のエラーは UnknownOutcomeError (再送しない)。
 */
export async function attemptBooking(browser: Browser, p: BookParams, attempt: number): Promise<BookResult> {
  const { artifacts: art } = p;
  const ctx = await newBookingContext(browser, p.session);
  const page = await ctx.newPage();
  const timeoutMs = p.session.timeout_ms;
  // submitConfirm のコールバック内でも書き換えるので、絞り込みされないようオブジェクトで持つ
  const st: { stage: "frames" | "input" | "submitted" } = { stage: "frames" };
  try {
    await openNewBooking(page, p.clinic, timeoutMs);
    await selectTodayAndCount(page, p.patients.length, timeoutMs);
    const frame = await pickFrame(page, p.frame, (m) => art.log(m));
    await art.capture(page, "frames");
    art.log(`枠「${frame.name}」を選択`);

    await goToInput(page, frame, timeoutMs);
    st.stage = "input";
    await fillInputAndProceed(page, p.patients, {
      timeoutMs,
      log: (m) => art.log(m),
      ...(p.clinic.cancel_code ? { cancelCode: p.clinic.cancel_code } : {}),
    });
    const confirmText = await verifyConfirm(page, p.patients, timeoutMs);
    const shot = await art.capture(page, "confirm", { personal: true });
    art.log("確認画面に到達しました");

    if (!p.submit) {
      await p.onConfirm?.(page);
      return { kind: "dry-run", frame, confirmText, ...(shot ? { screenshot: shot } : {}) };
    }

    art.log("「予約する」を押します (1 回のみ)");
    await submitConfirm(page, 60_000, () => {
      st.stage = "submitted";
      p.onSubmit?.();
    });
    // 完了画面に着いた時点で予約は成立している。読み取りの失敗で結果不明にしない
    const info = await readComplete(page).catch(
      (e: Error) => ({ text: `(完了画面の読み取りに失敗: ${e.message})` }) as Awaited<ReturnType<typeof readComplete>>,
    );
    const done = await art.capture(page, "complete", { personal: true });
    return {
      kind: "booked",
      frame,
      text: info.text,
      ...(info.acceptNo ? { acceptNo: info.acceptNo } : {}),
      ...(done ? { screenshot: done } : {}),
    };
  } catch (e) {
    await art.capture(page, `error-${attempt}`, { personal: st.stage !== "frames" });
    const msg = (e as Error).message.split("\n")[0];
    if (st.stage === "submitted") {
      // 送信後に再試行される例外 (NotOpenError 等) を絶対に外へ出さない
      if (e instanceof FullError || e instanceof AlreadyBookedError || e instanceof UnknownOutcomeError) throw e;
      throw new UnknownOutcomeError(`予約ボタン押下後にエラー。予約できたか手動で確認してください: ${msg}`);
    }
    if (e instanceof AppError) throw e;
    if (st.stage === "input")
      throw new AppError(
        `入力・確認画面の操作に失敗しました (画面構成が想定と違う可能性。artifacts を確認してください): ${msg}`,
      );
    throw new NotOpenError(`ブラウザ操作エラー: ${msg}`);
  } finally {
    await closeContext(ctx, p.session.trace ? join(art.dir, `trace-${attempt}.zip`) : undefined);
  }
}

/**
 * 枠一覧を読んで枠を選ぶ。空き状況の描画が遅れて全枠 × に見えることがあるので、
 * 満枠判定は少し待って読み直しても同じときだけ確定する。
 */
async function pickFrame(page: Page, pattern: string | undefined, log: (m: string) => void): Promise<FrameInfo> {
  for (let i = 0; ; i++) {
    const frames = await readFrames(page);
    for (const f of frames) {
      log(
        `  枠: ${f.name} ${f.wait} ${f.bookable ? "○予約可" : "×"}${f.outOfPeriod ? " (時間外)" : ""}${f.message ? ` ${f.message}` : ""}`,
      );
    }
    try {
      return chooseFrame(frames, pattern);
    } catch (e) {
      if (!(e instanceof FullError) || i >= 1) throw e;
      log("予約できる枠が見当たらないので 3 秒後に読み直します");
      await page.waitForTimeout(3000);
    }
  }
}
