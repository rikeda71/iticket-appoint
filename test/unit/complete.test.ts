import { describe, expect, it } from "vitest";
import { extractAcceptNo } from "../../src/pages/complete.js";

describe("extractAcceptNo", () => {
  it.each([
    ["受付番号：12", "12"],
    ["受付番号: 12", "12"],
    ["受付番号 12", "12"],
    ["受付番号は 5", "5"],
    ["受付番号は5です", "5"],
    ["受付番号：１２", "12"],
    ["受付番号は　７", "7"],
    ["予約を受け付けました。 受付番号：００３ です", "003"],
    ["受付番号\n42", "42"],
    ["予約番号：12番", "12"],
    ["予約番号\n\n12 番", "12"],
    ["整理番号は７番です", "7"],
    ["受付No. 15", "15"],
    ["受付ＮＯ：９", "9"],
    ["あなたの受付番号は【 23 】です", "23"],
    ["あなたの順番は 8 番です", "8"],
    ["番号：31", "31"],
    ["予約を受け付けました。受付は12番です", "12"],
    ["受付番号：なし 予約番号：9", "9"],
    ["診察券番号 10001\n受付番号 6", "6"],
    ["お名前 山田\n予約日時 2026年10月31日\n受付番号\n\n17", "17"],
  ])("%j -> %s", (text, expected) => {
    expect(extractAcceptNo(text)).toBe(expected);
  });

  it("受付番号がなければ undefined", () => {
    expect(extractAcceptNo("予約が完了しました")).toBeUndefined();
    expect(extractAcceptNo("")).toBeUndefined();
    expect(extractAcceptNo("受付番号：なし")).toBeUndefined();
  });

  it.each([
    "診察券番号：12345",
    "電話番号 090-1111-2222",
    "呼出番号 5 番の方は受付へ",
    "現在の番号：3",
    "受付番号 2026年10月31日",
    "受付番号 2026/10/31",
    "受付番号 10:30",
    "受付番号 090-1111-2222",
    "受付番号 09011112222",
    "受付時間 9時30分 3番目の方",
    "予約は3番目です",
    "受付番号\n予約日 2026-10-31",
  ])("誤検出しない: %j", (text) => {
    expect(extractAcceptNo(text)).toBeUndefined();
  });

  it("最初の受付番号を返す", () => {
    expect(extractAcceptNo("受付番号：3 受付番号：4")).toBe("3");
  });
});
