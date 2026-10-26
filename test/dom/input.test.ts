import type { Browser, BrowserContext, Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppError, MissingValueError, NotOpenError, ValidationError } from "../../src/flow/errors.js";
import { fillInputAndProceed } from "../../src/pages/input.js";
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

const html = fixture("input-form.html");
const INPUT_PATH = "/park2/clinics/1/businesses/01/bookings/new/20261026/frames/11/input";
const open = (mode?: string, body = html) => serveHtml(page, body, `${INPUT_PATH}${mode ? `?mode=${mode}` : ""}`);
const submitted = () => page.evaluate(() => (window as unknown as { __submitted: Record<string, unknown> }).__submitted);
const pathNow = () => new URL(page.url()).pathname;

describe("fillInputAndProceed: 入力部分", () => {
  it("text / select(生年月日) / radio(性別) / checkbox / textarea / 同意を埋めて確認画面へ進む", async () => {
    await open();
    const logs: string[] = [];
    const r = await fillInputAndProceed(page, [patient()], { timeoutMs: 5000, log: (m) => logs.push(m) });

    expect(pathNow()).toMatch(/\/bookings\/new_confirm$/);
    expect(r.fields.map((f) => f.key.name)).toContain("1_11_2_5_1_year");
    expect(await submitted()).toEqual({
      "1_10_1_1_1": ["山田 太郎"],
      "1_11_2_5_1_year": ["1990"],
      "1_11_2_5_1_month": ["1"],
      "1_11_2_5_1_date": ["2"],
      "1_12_3_2_1": ["0"],
      "1_15_4_1_1": ["09012345678"],
      "1_16_5_1_1": ["12345"],
      "1_13_8_1_0": ["ヤマダ タロウ"],
      "1_14_0_3_0": ["花粉", "卵"],
      "1_17_0_4_0": ["鼻水"],
      __consent: true,
    });
    expect(logs.some((l) => l.includes("「氏名」") && l.includes("fill"))).toBe(true);
  });

  it("必須マーク (.ipk-must-txt) はタイトルから除かれる", async () => {
    await open();
    const r = await fillInputAndProceed(page, [patient()], { timeoutMs: 5000 });
    expect(r.fields.find((f) => f.key.name === "1_10_1_1_1")?.title).toBe("氏名");
    expect(r.fields.find((f) => f.key.name === "1_12_3_2_1")?.title).toBe("性別");
  });

  it("女性・新患: 性別=女性、診察券番号欄に「新患」", async () => {
    await open();
    await fillInputAndProceed(page, [patient("hanako", { sex: "female", new_patient: true, patient_card_no: undefined })], { timeoutMs: 5000 });
    const s = (await submitted()) as Record<string, unknown>;
    expect(s["1_12_3_2_1"]).toEqual(["1"]);
    expect(s["1_16_5_1_1"]).toEqual(["新患"]);
  });

  it("任意項目に値がなければ空のまま送る", async () => {
    await open();
    await fillInputAndProceed(page, [patient("taro", { name_kana: undefined, custom_fields: {} })], { timeoutMs: 5000 });
    const s = (await submitted()) as Record<string, unknown>;
    expect(s["1_13_8_1_0"]).toEqual([""]);
    expect(s["1_17_0_4_0"]).toEqual([""]);
    expect(s["1_14_0_3_0"]).toBeUndefined();
  });

  it("入力時に電話番号を整形するサイトでも (数字だけで比較して) 通る", async () => {
    await open();
    await page.evaluate(() => {
      const el = document.querySelector<HTMLInputElement>('[name="1_15_4_1_1"]')!;
      el.addEventListener("input", () => {
        const d = el.value.replace(/\D/g, "");
        el.value = d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : d;
      });
    });
    await fillInputAndProceed(page, [patient()], { timeoutMs: 5000 });
    expect(((await submitted()) as Record<string, unknown>)["1_15_4_1_1"]).toEqual(["090-1234-5678"]);
  });

  it("値を受け付けない欄は ValidationError (読み戻しが違う)", async () => {
    await open();
    await page.evaluate(() => {
      const el = document.querySelector<HTMLInputElement>('[name="1_10_1_1_1"]')!;
      el.addEventListener("input", () => (el.value = "固定"));
    });
    await expect(fillInputAndProceed(page, [patient()], { timeoutMs: 3000 })).rejects.toThrow(ValidationError);
    expect(pathNow()).toMatch(/\/input$/);
  });

  it("select の value が一致しなければラベルで選ぶ (数字は境界つき: 「2」は「12日」に当たらない)", async () => {
    await open();
    await page.evaluate(() => {
      for (const s of document.querySelectorAll<HTMLSelectElement>("select[name^='1_11_2_5_1']")) {
        for (const o of s.options) if (o.value !== "") o.value = `x${o.value}`;
      }
    });
    await fillInputAndProceed(page, [patient("taro", { birth: "1995-12-02" })], { timeoutMs: 5000 });
    const s = (await submitted()) as Record<string, unknown>;
    expect(s["1_11_2_5_1_year"]).toEqual(["x1995"]);
    expect(s["1_11_2_5_1_month"]).toEqual(["x12"]);
    expect(s["1_11_2_5_1_date"]).toEqual(["x2"]);
  });

  it("select に該当する選択肢がなければ ValidationError", async () => {
    await open();
    await expect(fillInputAndProceed(page, [patient("taro", { birth: "1850-01-02" })], { timeoutMs: 3000 })).rejects.toThrow(
      /生年月日.*選択肢 1850 がありません/,
    );
  });

  it("性別の選択肢が見つからなければ MissingValueError", async () => {
    await open();
    await page.evaluate(() => {
      for (const r of document.querySelectorAll<HTMLInputElement>('input[type=radio]')) r.value = "9";
      for (const l of document.querySelectorAll("label[for^='sex-']")) l.textContent = "不明";
    });
    await expect(fillInputAndProceed(page, [patient()], { timeoutMs: 3000 })).rejects.toThrow(MissingValueError);
  });

  it("必須項目に入れる値がなければ、何も入力せず MissingValueError", async () => {
    await open();
    await expect(fillInputAndProceed(page, [patient("taro", { patient_card_no: undefined })], { timeoutMs: 3000 })).rejects.toThrow(
      /必須項目「診察券番号」/,
    );
    expect(await page.locator('[name="1_10_1_1_1"]').inputValue()).toBe("");
  });

  it("画面の人数と患者数が違えば AppError", async () => {
    await open();
    await expect(fillInputAndProceed(page, [patient("a"), patient("b")], { timeoutMs: 3000 })).rejects.toThrow(AppError);
  });

  it("入力欄がなければ AppError", async () => {
    await open(undefined, '<section class="ipk-input-patient"><form><input name="foo"></form></section>');
    await expect(fillInputAndProceed(page, [patient()], { timeoutMs: 3000 })).rejects.toThrow(/入力欄が見つかりません/);
  });
});

describe("fillInputAndProceed: 送信後", () => {
  it("バリデーションエラー表示なら ValidationError (メッセージを連結)", async () => {
    await open("error");
    const e = await fillInputAndProceed(page, [patient()], { timeoutMs: 3000 }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ValidationError);
    expect((e as Error).message).toBe("入力エラー: 氏名を入力してください / 電話番号が正しくありません");
  });

  it("エラーモーダルなら modalError (受付時間外は NotOpenError)", async () => {
    await open("modal");
    await expect(fillInputAndProceed(page, [patient()], { timeoutMs: 3000 })).rejects.toThrow(NotOpenError);
  });

  it("利用規約モーダルが出たら「はい」を押して進む", async () => {
    await open("terms", html.replace(/<div>\s*<input type="checkbox" id="consent-checkbox">.*?<\/div>/s, ""));
    expect(await page.locator("input#consent-checkbox").count()).toBe(0);
    await fillInputAndProceed(page, [patient()], { timeoutMs: 5000 });
    expect(await page.evaluate(() => (window as unknown as { __termsAccepted?: boolean }).__termsAccepted)).toBe(true);
    expect(pathNow()).toMatch(/new_confirm$/);
  });

  it("次へは 1 回だけ押す", async () => {
    await open();
    await fillInputAndProceed(page, [patient()], { timeoutMs: 5000 });
    expect(await page.evaluate(() => (window as unknown as { __clicks: number }).__clicks)).toBe(1);
  });

  it("確認画面に進まず何も出なければ NotOpenError (タイムアウト)", async () => {
    await open();
    await page.evaluate(() => {
      document.querySelector("div.btn-area button")!.addEventListener("click", (e) => e.stopImmediatePropagation(), true);
    });
    await expect(fillInputAndProceed(page, [patient()], { timeoutMs: 800 })).rejects.toThrow(/確認画面に進めませんでした/);
  });
});

describe("fillInputAndProceed: キャンセルコード", () => {
  it("欄があるのに cancel_code 未設定なら MissingValueError", async () => {
    await open("cancel");
    await expect(fillInputAndProceed(page, [patient()], { timeoutMs: 3000 })).rejects.toThrow(MissingValueError);
  });

  it("cancel_code を入力して送信する", async () => {
    await open("cancel");
    await fillInputAndProceed(page, [patient()], { cancelCode: "1234", timeoutMs: 5000 });
    expect(((await submitted()) as Record<string, unknown>)["cancelCode"]).toEqual(["1234"]);
  });

  it("欄がなければ cancel_code を設定していても無視する", async () => {
    await open();
    await fillInputAndProceed(page, [patient()], { cancelCode: "1234", timeoutMs: 5000 });
    expect(((await submitted()) as Record<string, unknown>)["cancelCode"]).toBeUndefined();
  });
});
