import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Ledger, localDate } from "../../src/guard/ledger.js";
import { acquireLock, LockedError } from "../../src/guard/lock.js";

const tmp = () => mkdtempSync(join(tmpdir(), "iticket-"));

describe("Ledger", () => {
  it("同じ日・医院・患者の予約を検出する", () => {
    const l = new Ledger(tmp());
    expect(l.findBooked("2026-10-26", "takeda", ["taro"])).toBeUndefined();
    l.record({ date: "2026-10-26", clinic: "takeda", patients: ["taro", "hanako"], accept_no: "12", at: "x" });
    expect(l.findBooked("2026-10-26", "takeda", ["hanako"])?.accept_no).toBe("12");
    expect(l.findBooked("2026-10-27", "takeda", ["taro"])).toBeUndefined();
    expect(l.findBooked("2026-10-26", "other", ["taro"])).toBeUndefined();
    expect(l.findBooked("2026-10-26", "takeda", ["jiro"])).toBeUndefined();
  });

  it("壊れた行は無視する", () => {
    const dir = tmp();
    writeFileSync(join(dir, "ledger.jsonl"), 'not json\n{"date":"2026-10-26","clinic":"c","patients":["a"],"at":"x"}\n');
    expect(new Ledger(dir).entries()).toHaveLength(1);
  });

  it("localDate", () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59).getTime())).toBe("2026-01-05");
  });
});

describe("acquireLock", () => {
  it("二重取得できない・解放後は取得できる", () => {
    const dir = tmp();
    const release = acquireLock(dir, "takeda");
    expect(() => acquireLock(dir, "takeda")).toThrow(LockedError);
    expect(() => acquireLock(dir, "other")()).not.toThrow();
    release();
    release(); // 2 回呼んでも安全
    acquireLock(dir, "takeda")();
  });

  it("死んだプロセスのロックは奪う", () => {
    const dir = tmp();
    writeFileSync(join(dir, "takeda.lock"), "999999");
    acquireLock(dir, "takeda")();
  });
});
