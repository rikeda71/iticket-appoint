import type { Browser, BrowserContext, Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FullError, NotOpenError, ValidationError } from "../../src/flow/errors.js";
import { chooseFrame, goToInput, openNewBooking, readFrames, selectTodayAndCount } from "../../src/pages/new-booking.js";
import { fixture, launch, newPage, serveHtml } from "./helpers.js";

let browser: Browser;
let context: BrowserContext;
let page: Page;

beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser.close();
});
beforeEach(async () => {
  ({ context, page } = await newPage(browser));
});
afterEach(async () => {
  await context.close();
});

const frames = fixture("new-booking-frames.html");

describe("readFrames", () => {
  it("枠名・待ち・予約可否・時間外・メッセージを読む", async () => {
    await serveHtml(page, frames);
    const fs = await readFrames(page);
    expect(fs).toHaveLength(5);
    expect(fs[0]).toEqual({
      index: 0,
      name: "午前(09:00 - 12:30)",
      wait: "現在 3人 待ち",
      bookable: true,
      outOfPeriod: false,
      message: "",
    });
    expect(fs[1]).toMatchObject({ name: "午後(15:00 - 18:00)", wait: "現在 10人 待ち", bookable: false, message: "満員のため受付を終了しました" });
    expect(fs[2]).toMatchObject({ name: "夜(19:00 - 21:00)", bookable: false, outOfPeriod: true });
    // is-hidden クラス付きのボタンは、見えていても予約不可
    expect(fs[3]).toMatchObject({ name: "予備(22:00 - 23:00)", bookable: false, outOfPeriod: false });
    expect(fs[4]).toMatchObject({ name: "特別(23:00 - 23:30)", bookable: true });
  });

  it("枠グループがなければ空配列", async () => {
    await serveHtml(page, '<section class="ipk-time-list-j"></section>');
    expect(await readFrames(page)).toEqual([]);
  });
});

describe("readFrames + chooseFrame", () => {
  it("pattern なしは最初の○枠", async () => {
    await serveHtml(page, frames);
    expect(chooseFrame(await readFrames(page)).index).toBe(0);
  });

  it("pattern で部分一致した○枠を選ぶ", async () => {
    await serveHtml(page, frames);
    expect(chooseFrame(await readFrames(page), "特別").index).toBe(4);
  });

  it("× 枠だけを指定すると FullError", async () => {
    await serveHtml(page, frames);
    const fs = await readFrames(page);
    expect(() => chooseFrame(fs, "午後")).toThrow(FullError);
  });

  it("時間外の枠を指定すると NotOpenError", async () => {
    await serveHtml(page, frames);
    const fs = await readFrames(page);
    expect(() => chooseFrame(fs, "夜")).toThrow(NotOpenError);
  });

  it("is-hidden クラス付きボタンだけの枠は FullError", async () => {
    await serveHtml(page, frames);
    const fs = await readFrames(page);
    expect(() => chooseFrame(fs, "予備")).toThrow(FullError);
  });

  it("存在しない枠名は ValidationError", async () => {
    await serveHtml(page, frames);
    const fs = await readFrames(page);
    expect(() => chooseFrame(fs, "早朝")).toThrow(ValidationError);
  });
});


describe("goToInput", () => {
  it("○枠の「次へ」で入力画面の URL に遷移する", async () => {
    await serveHtml(page, frames);
    const fs = await readFrames(page);
    await goToInput(page, chooseFrame(fs), 3000);
    expect(new URL(page.url()).pathname).toMatch(/\/frames\/11\/input$/);
  });

  it("エラーモーダルが出たら例外 (時間外は NotOpenError)", async () => {
    await serveHtml(page, frames);
    const fs = await readFrames(page);
    await expect(goToInput(page, chooseFrame(fs, "特別"), 3000)).rejects.toThrow(NotOpenError);
  });
});

describe("selectTodayAndCount", () => {
  it("人数欄があり 1 人なら何もしない", async () => {
    await serveHtml(page, frames);
    await selectTodayAndCount(page, 1, 3000);
    expect(await page.locator("section.ipk-select-book-num select").inputValue()).toBe("1");
  });

  it("人数欄がなく複数人なら ValidationError", async () => {
    await serveHtml(page, frames.replace(/<section class="ipk-select-book-num">.*?<\/section>/s, ""));
    await expect(selectTodayAndCount(page, 2, 3000)).rejects.toThrow(ValidationError);
    await expect(selectTodayAndCount(page, 1, 3000)).resolves.toBeUndefined();
  });
});

describe("openNewBooking (https://park.paa.jp をローカルで差し替え)", () => {
  const clinic = { owner_id: "1", business_no: "01" };
  const origin = "https://park.paa.jp";
  const topHtml = fixture("business-top-closed.html");

  it("枠一覧が出れば成功", async () => {
    await page.route(`${origin}/**`, (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: frames }));
    await openNewBooking(page, clinic, 5000);
    expect(new URL(page.url()).pathname).toBe("/park2/clinics/1/businesses/01/bookings/new");
  });

  it("TOP に戻されたら「診察時間外」付きの NotOpenError", async () => {
    // クライアント側のリダイレクトを模す (302 を fulfill すると route を通らず実サイトへ出てしまうため使わない)
    const redirected = `${topHtml}<script>history.replaceState(null, "", "/park2/clinics/1/businesses/01")</script>`;
    await page.route(`${origin}/**`, (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: redirected }));
    await expect(openNewBooking(page, clinic, 5000)).rejects.toThrow(/TOP に戻されました: 診察時間外/);
    await expect(openNewBooking(page, clinic, 5000)).rejects.toBeInstanceOf(NotOpenError);
  });

  it("当日の枠がなければ NotOpenError", async () => {
    const none = `<section class="ipk-date-select"><span>本日</span></section><section class="ipk-time-list-j"></section>
      <section class="ipk-non-time-frame"><p>現在、予約可能な時間ではありません。</p></section>`;
    await page.route(`${origin}/**`, (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: none }));
    await expect(openNewBooking(page, clinic, 5000)).rejects.toThrow(/当日の枠がありません: 現在、予約可能な時間ではありません/);
  });
});

