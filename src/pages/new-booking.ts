import type { Page } from "playwright";
import type { Clinic } from "../config/schema.js";
import { FullError, NotOpenError, ValidationError } from "../flow/errors.js";
import { NEW_BOOKING, TOP } from "../site/selectors.js";
import { businessTopUrl, newBookingUrl, PATH, pathOf } from "../site/urls.js";
import { squash } from "./business-top.js";
import { modalError } from "./modal.js";
import { waitOutcome } from "./outcome.js";

export interface FrameInfo {
  index: number;
  /** 例: "午前(09:00 - 12:30)" */
  name: string;
  /** 例: "現在 3人 待ち" */
  wait: string;
  /** 「次へ」ボタンが表示されている (○ / △) */
  bookable: boolean;
  /** 予約可能時間外の表示 */
  outOfPeriod: boolean;
  /** × のときのメッセージ (exceed_limit_message) */
  message: string;
}

/**
 * ビジネス TOP の「予約へ」から /bookings/new に入る。受付時間外はビジネス TOP に戻されるので NotOpenError。
 * 当日枠一覧が出るまで待つ。
 * 実サイトは /bookings/new を直接開くと受付中でも 307 で TOP に戻す (SPA 内遷移でのみ入れる) ため、
 * TOP の読み込み (hydration) を待ってからリンクを押す。リンクがなければ直接開く。
 */
export async function openNewBooking(page: Page, clinic: Clinic, timeoutMs = 20_000): Promise<void> {
  await page.goto(businessTopUrl(clinic), { waitUntil: "load" });
  const link = page.locator(TOP.bookLink).first();
  const hasLink = await link
    .waitFor({ state: "visible", timeout: Math.min(timeoutMs, 5000) })
    .then(() => true)
    .catch(() => false);
  if (hasLink) await link.click();
  else await page.goto(newBookingUrl(clinic), { waitUntil: "domcontentloaded" });
  await page.waitForURL((u) => PATH.newBooking.test(u.pathname), { timeout: 5000 }).catch(() => undefined);
  await page
    .locator(NEW_BOOKING.root)
    .or(page.locator(TOP.situationRoot))
    .first()
    .waitFor({ state: "visible", timeout: timeoutMs });
  if (!PATH.newBooking.test(pathOf(page.url()))) {
    const status = await page
      .locator(TOP.nonService)
      .first()
      .textContent({ timeout: 2000 })
      .catch(() => null);
    throw new NotOpenError(`予約画面に入れません (TOP に戻されました${status ? `: ${status.trim()}` : ""})`);
  }
  await waitFrames(page, timeoutMs);
}

async function waitFrames(page: Page, timeoutMs: number): Promise<void> {
  const groups = page.locator(NEW_BOOKING.frameGroup);
  const noFrame = page.locator(NEW_BOOKING.noFrame);
  try {
    await groups.or(noFrame).first().waitFor({ state: "visible", timeout: timeoutMs });
  } catch {
    throw new NotOpenError("当日の枠一覧が表示されません");
  }
  if ((await groups.count()) === 0 && (await noFrame.count()) > 0) {
    throw new NotOpenError(`当日の枠がありません: ${squash(await noFrame.first().innerText())}`);
  }
}

/** 当日 (search_vacancy_flg=1 の医院のみラジオがある) と人数を選ぶ */
export async function selectTodayAndCount(page: Page, count: number, timeoutMs = 20_000): Promise<void> {
  const today = page.locator(NEW_BOOKING.todayRadio);
  if ((await today.count()) > 0 && !(await today.isChecked())) {
    await page.locator(NEW_BOOKING.todayLabel).click();
    await waitFrames(page, timeoutMs);
  }
  const select = page.locator(NEW_BOOKING.patientCountSelect);
  if ((await select.count()) === 0) {
    if (count > 1) throw new ValidationError("この医院では複数人をまとめて予約できません (人数欄がありません)");
    return;
  }
  if ((await select.inputValue()) !== String(count)) {
    await select.selectOption(String(count));
    // 人数変更で空き状況が再取得される
    await page.waitForTimeout(500);
    await waitFrames(page, timeoutMs);
  }
}

export async function readFrames(page: Page): Promise<FrameInfo[]> {
  const groups = page.locator(NEW_BOOKING.frameGroup);
  const n = await groups.count();
  const frames: FrameInfo[] = [];
  for (let i = 0; i < n; i++) {
    const g = groups.nth(i);
    const text = async (sel: string) => {
      const l = g.locator(sel).first();
      return (await l.count()) > 0 ? squash(await l.innerText()) : "";
    };
    const btn = g.locator(NEW_BOOKING.frameNextButton).first();
    const bookable =
      (await btn.count()) > 0 &&
      !((await btn.getAttribute("class")) ?? "").split(/\s+/).includes(NEW_BOOKING.frameNextButtonHidden) &&
      (await btn.isVisible());
    frames.push({
      index: i,
      name: (await text(NEW_BOOKING.frameName)).replace(/\s*\/\s*/g, ""),
      wait: await text(NEW_BOOKING.frameWait),
      bookable,
      outOfPeriod: (await g.locator(NEW_BOOKING.frameOutOfPeriod).count()) > 0,
      message: await text(NEW_BOOKING.frameMessage),
    });
  }
  return frames;
}

/** 予約する枠を選ぶ純粋関数。pattern は枠名の部分一致 */
export function chooseFrame(frames: FrameInfo[], pattern?: string): FrameInfo {
  const describe = (fs: FrameInfo[]) =>
    fs.map((f) => `${f.name}${f.wait ? ` ${f.wait}` : ""}${f.message ? ` (${f.message})` : ""}`).join(", ");
  if (frames.length === 0) throw new NotOpenError("当日の枠がありません");
  const candidates = pattern ? frames.filter((f) => f.name.includes(pattern)) : frames;
  if (candidates.length === 0) {
    throw new ValidationError(`枠「${pattern}」が見つかりません (あるのは: ${describe(frames)})`);
  }
  const ok = candidates.find((f) => f.bookable);
  if (ok) return ok;
  if (candidates.some((f) => f.outOfPeriod)) throw new NotOpenError(`予約可能時間外です: ${describe(candidates)}`);
  throw new FullError(`予約できる枠がありません: ${describe(candidates)}`);
}

/** 枠の「次へ」を押して入力画面へ */
export async function goToInput(page: Page, frame: FrameInfo, timeoutMs = 20_000): Promise<void> {
  await page.locator(NEW_BOOKING.frameGroup).nth(frame.index).locator(NEW_BOOKING.frameNextButton).first().click();
  const o = await waitOutcome(page, PATH.input, timeoutMs);
  if (o.kind === "modal") throw modalError(o.text);
  if (o.kind !== "url") throw new NotOpenError("入力画面に進めませんでした (タイムアウト)");
}
