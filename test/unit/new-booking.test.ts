import { describe, expect, it } from "vitest";
import { FullError, NotOpenError, ValidationError } from "../../src/flow/errors.js";
import { chooseFrame, type FrameInfo } from "../../src/pages/new-booking.js";

const frame = (index: number, name: string, over: Partial<FrameInfo> = {}): FrameInfo => ({
  index,
  name,
  wait: "",
  bookable: false,
  outOfPeriod: false,
  message: "",
  ...over,
});

describe("chooseFrame", () => {
  it("枠が 0 件なら NotOpenError", () => {
    expect(() => chooseFrame([])).toThrow(NotOpenError);
    expect(() => chooseFrame([], "午前")).toThrow(NotOpenError);
  });

  it("pattern なしは予約可能な最初の枠", () => {
    const fs = [frame(0, "午前", { bookable: false }), frame(1, "午後", { bookable: true }), frame(2, "夜", { bookable: true })];
    expect(chooseFrame(fs).index).toBe(1);
  });

  it("pattern は枠名の部分一致", () => {
    const fs = [frame(0, "午前(09:00-12:30)", { bookable: true }), frame(1, "午後(15:00-18:00)", { bookable: true })];
    expect(chooseFrame(fs, "午後").index).toBe(1);
  });

  it("pattern に合う枠がなければ ValidationError (あるのは: を案内)", () => {
    const fs = [frame(0, "午前", { bookable: true, wait: "現在 3人 待ち" })];
    expect(() => chooseFrame(fs, "夜")).toThrow(ValidationError);
    expect(() => chooseFrame(fs, "夜")).toThrow(/午前 現在 3人 待ち/);
  });

  it("pattern に合う枠が予約不可で他の枠が予約可能でも、他の枠は選ばない", () => {
    const fs = [frame(0, "午前", { bookable: false }), frame(1, "午後", { bookable: true })];
    expect(() => chooseFrame(fs, "午前")).toThrow(FullError);
  });

  it("予約可能な枠がなく時間外の枠があれば NotOpenError", () => {
    const fs = [frame(0, "午前", { outOfPeriod: true }), frame(1, "午後")];
    expect(() => chooseFrame(fs)).toThrow(NotOpenError);
    expect(() => chooseFrame(fs)).toThrow(/予約可能時間外/);
  });

  it("全て × で時間外でもなければ FullError (メッセージを案内)", () => {
    const fs = [frame(0, "午前", { message: "受付終了しました" })];
    expect(() => chooseFrame(fs)).toThrow(FullError);
    expect(() => chooseFrame(fs)).toThrow(/受付終了しました/);
  });

  it("pattern 指定時の時間外判定は候補だけを見る", () => {
    const fs = [frame(0, "午前", { outOfPeriod: true }), frame(1, "午後")];
    expect(() => chooseFrame(fs, "午後")).toThrow(FullError);
    expect(() => chooseFrame(fs, "午前")).toThrow(NotOpenError);
  });

  it("予約可能な枠があれば時間外の枠が混ざっていても選ぶ", () => {
    const fs = [frame(0, "午前", { outOfPeriod: true }), frame(1, "午後", { bookable: true })];
    expect(chooseFrame(fs).index).toBe(1);
  });
});
