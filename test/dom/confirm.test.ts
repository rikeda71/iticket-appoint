import type { Browser, BrowserContext, Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AlreadyBookedError, AppError, FullError, NotOpenError, UnknownOutcomeError } from "../../src/flow/errors.js";
import { submitConfirm, verifyConfirm } from "../../src/pages/confirm.js";
import { fixture, launch, newPage, patient, serveHtml } from "./helpers.js";

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

const html = fixture("confirm.html");
const CONFIRM_PATH = "/park2/clinics/1/businesses/01/bookings/new_confirm";
const taro = () => patient("taro");
const hanako = () => patient("hanako", { name: "鈴木花子", phone: "08011112222" });

describe("verifyConfirm", () => {
  it("氏名・電話番号が設定どおりなら表示テキストを返す (空白・全角差は無視)", async () => {
    await serveHtml(page, html, CONFIRM_PATH);
    const text = await verifyConfirm(page, [taro(), hanako()], 3000);
    expect(text).toContain("山田");
    expect(text).toContain("鈴木");
    expect(text.split("\n")).toHaveLength(2);
  });

  it("1 人だけ照合しても通る", async () => {
    await serveHtml(page, html, CONFIRM_PATH);
    await expect(verifyConfirm(page, [taro()], 3000)).resolves.toContain("山田");
  });

  it("氏名が違えば AppError (何人目の誰かを示す)", async () => {
    await serveHtml(page, html, CONFIRM_PATH);
    const e = await verifyConfirm(page, [patient("jiro", { name: "佐藤 次郎" })], 3000).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AppError);
    expect((e as Error).message).toBe("確認画面の 1 人目に jiro の氏名が見当たりません");
  });

  it("2 人目だけ違う場合は 2 人目を指摘する", async () => {
    await serveHtml(page, html, CONFIRM_PATH);
    await expect(verifyConfirm(page, [taro(), patient("jiro", { name: "佐藤 次郎" })], 3000)).rejects.toThrow(/2 人目に jiro/);
  });

  it("患者ブロックが足りなければ AppError", async () => {
    await serveHtml(page, html, CONFIRM_PATH);
    await expect(verifyConfirm(page, [taro(), hanako(), patient("c", { name: "三人目" })], 3000)).rejects.toThrow(/3 人目に c の氏名/);
  });

  it("電話番号が表示されていて設定と違えば AppError", async () => {
    await serveHtml(page, html, CONFIRM_PATH);
    await expect(verifyConfirm(page, [patient("taro", { phone: "090-9999-9999" })], 3000)).rejects.toThrow(/電話番号が設定と一致しません/);
  });

  it("電話番号が表示されていなければ照合しない", async () => {
    await serveHtml(page, html, CONFIRM_PATH);
    // 2 人目のブロックには電話の表示がない
    await expect(verifyConfirm(page, [taro(), patient("hanako", { name: "鈴木花子", phone: "03-0000-0000" })], 3000)).resolves.toBeTypeOf("string");
  });

  it("案内文が「まだ完了していません」でなければ AppError", async () => {
    await serveHtml(page, html.replace("予約はまだ完了していません", "予約が完了しました"), CONFIRM_PATH);
    await expect(verifyConfirm(page, [taro()], 3000)).rejects.toThrow(/確認画面の表示が想定と違います/);
  });

  it("確認画面でなければタイムアウト", async () => {
    await serveHtml(page, "<p>違う画面</p>", CONFIRM_PATH);
    await expect(verifyConfirm(page, [taro()], 500)).rejects.toThrow();
  });
});

describe("submitConfirm", () => {
  const setup = async (onClick: "complete" | { modal: string } | "nothing") => {
    await serveHtml(page, html, CONFIRM_PATH);
    await page.evaluate((mode) => {
      document.body.insertAdjacentHTML("beforeend", `<section class="ipk-exception-error" style="display:none"><div class="ipk-exception-error-body"></div></section>`);
      (window as unknown as { __clicks: number }).__clicks = 0;
      document.getElementById("submit")!.addEventListener("click", () => {
        (window as unknown as { __clicks: number }).__clicks++;
        if (mode === "complete") history.pushState(null, "", "/park2/clinics/1/businesses/01/bookings/new_complete");
        else if (mode !== "nothing") {
          const m = document.querySelector<HTMLElement>("section.ipk-exception-error")!;
          m.querySelector(".ipk-exception-error-body")!.textContent = mode.modal;
          m.style.display = "block";
        }
      });
    }, onClick);
  };
  const clicks = () => page.evaluate(() => (window as unknown as { __clicks: number }).__clicks);

  it("完了画面に遷移すれば resolve し、押すのは 1 回で beforeClick が先に呼ばれる", async () => {
    await setup("complete");
    const before = vi.fn();
    await submitConfirm(page, 3000, before);
    expect(before).toHaveBeenCalledTimes(1);
    expect(await clicks()).toBe(1);
    expect(new URL(page.url()).pathname).toMatch(/new_complete$/);
  });

  it("満枠モーダルは FullError", async () => {
    await setup({ modal: "定員に達したため予約できません" });
    await expect(submitConfirm(page, 3000)).rejects.toThrow(FullError);
  });

  it("重複モーダルは AlreadyBookedError", async () => {
    await setup({ modal: "既に予約されています" });
    await expect(submitConfirm(page, 3000)).rejects.toThrow(AlreadyBookedError);
  });

  it("セッション切れは AppError (再送しない・UnknownOutcome ではない)", async () => {
    await setup({ modal: "時間が経っているのでトップページからやり直してください。" });
    const e = await submitConfirm(page, 3000).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AppError);
    expect(e).not.toBeInstanceOf(UnknownOutcomeError);
    expect(e).not.toBeInstanceOf(NotOpenError);
  });

  it("通信エラーは UnknownOutcomeError", async () => {
    await setup({ modal: "通信エラーが発生しました" });
    await expect(submitConfirm(page, 3000)).rejects.toThrow(UnknownOutcomeError);
  });

  it("その他のモーダルは UnknownOutcomeError", async () => {
    await setup({ modal: "謎のメッセージ" });
    await expect(submitConfirm(page, 3000)).rejects.toThrow(UnknownOutcomeError);
  });

  it("何も起きなければ UnknownOutcomeError で、再クリックしない", async () => {
    await setup("nothing");
    await expect(submitConfirm(page, 600)).rejects.toThrow(UnknownOutcomeError);
    expect(await clicks()).toBe(1);
  });
});
