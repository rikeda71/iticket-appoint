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
  ])("%j -> %s", (text, expected) => {
    expect(extractAcceptNo(text)).toBe(expected);
  });

  it("受付番号がなければ undefined", () => {
    expect(extractAcceptNo("予約が完了しました")).toBeUndefined();
    expect(extractAcceptNo("")).toBeUndefined();
    expect(extractAcceptNo("受付番号：なし")).toBeUndefined();
  });

  it("最初の受付番号を返す", () => {
    expect(extractAcceptNo("受付番号：3 受付番号：4")).toBe("3");
  });
});
