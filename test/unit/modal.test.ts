import { describe, expect, it } from "vitest";
import { AlreadyBookedError, AppError, FullError, NotOpenError } from "../../src/flow/errors.js";
import { classifyModalText, modalError } from "../../src/pages/modal.js";

describe("classifyModalText", () => {
  it.each([
    ["時間が経っているのでトップページからやり直してください。", "session"],
    ["時間が経っています。トップページからやり直してください", "session"],
    ["最初からやり直してください", "other"],
    ["やり直してください", "other"],
    ["サーバーエラーが発生しました", "transient"],
    ["通信エラーが発生しました", "transient"],
    ["しばらく時間を空けてお試しください", "transient"],
    ["しばらく時間を開けてから再度お試しください", "transient"],
    ["既に予約されています", "already"],
    ["すでに予約があります", "already"],
    ["同一の患者様の予約が重複しています", "already"],
    ["同一患者の予約があります", "already"],
    ["満員のため受付できません", "full"],
    ["受付上限に達しました", "full"],
    ["定員に達しました", "full"],
    ["人数制限を超えています", "full"],
    ["受付を終了しました", "full"],
    ["受付終了しました", "full"],
    ["受付を締め切りました", "full"],
    ["受付を締切ました", "full"],
    ["本日の受付は終了しました", "full"],
    ["満了しました", "full"],
    ["満枠です", "full"],
    ["満足度アンケート", "other"],
    ["受付時間外のため受付できません", "notOpen"],
    ["空きがありません", "full"],
    ["現在受付できません", "full"],
    ["現在、予約可能な時間ではありません。", "notOpen"],
    ["受付時間外です", "notOpen"],
    ["予約時間外です", "notOpen"],
    ["受付前です", "notOpen"],
    ["受付開始前です", "notOpen"],
    ["まだ受付を開始していません", "notOpen"],
    ["診察時間外です", "notOpen"],
    ["予期せぬ問題が起きました", "other"],
    ["", "other"],
  ] as const)("%s -> %s", (text, kind) => {
    expect(classifyModalText(text)).toBe(kind);
  });

  describe("分類順序による優先", () => {
    it("session は transient/already より優先", () => {
      expect(classifyModalText("通信エラーです。時間が経っているのでトップページからやり直してください")).toBe("session");
      expect(classifyModalText("既に予約があります。トップページからやり直してください")).toBe("session");
    });
    it("transient は already より優先", () => {
      expect(classifyModalText("サーバーエラー: 既に予約があります")).toBe("transient");
    });
    it("already は full より優先", () => {
      expect(classifyModalText("既に予約があり、定員です")).toBe("already");
    });
    it("notOpen は full より優先", () => {
      expect(classifyModalText("受付時間外のため満員です")).toBe("notOpen");
    });
  });
});

describe("modalError", () => {
  it("session / notOpen / transient は NotOpenError (再試行対象)", () => {
    for (const t of ["時間が経っているのでトップページからやり直してください", "受付時間外です", "通信エラーです"]) {
      expect(modalError(t)).toBeInstanceOf(NotOpenError);
    }
  });
  it("full は FullError", () => {
    expect(modalError("定員に達しました")).toBeInstanceOf(FullError);
  });
  it("already は AlreadyBookedError", () => {
    expect(modalError("既に予約されています")).toBeInstanceOf(AlreadyBookedError);
  });
  it("other は素の AppError で、メッセージに本文を含む", () => {
    const e = modalError("謎のメッセージ");
    expect(e).toBeInstanceOf(AppError);
    expect(e).not.toBeInstanceOf(NotOpenError);
    expect(e).not.toBeInstanceOf(FullError);
    expect(e.message).toContain("謎のメッセージ");
  });
});
