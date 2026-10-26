import { describe, expect, it } from "vitest";
import { GaveUpError, NotOpenError, ValidationError } from "../../src/flow/errors.js";
import { poll } from "../../src/wait/poller.js";
import {
  nextDelayMs,
  prewarmAt,
  resolveDeadline,
  resolveTarget,
  sleepUntil,
  todayAt,
  type Clock,
} from "../../src/wait/schedule.js";

function fakeClock(start: number): Clock & { sleeps: number[] } {
  let t = start;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
  };
}

const at = (h: number, m: number, s = 0) => new Date(2026, 9, 26, h, m, s).getTime();

describe("schedule", () => {
  it("todayAt", () => {
    expect(todayAt("09:00", at(7, 30))).toBe(at(9, 0));
    expect(() => todayAt("9:00", at(7, 30))).toThrow();
  });

  it("resolveTarget: 未指定・過去なら即時", () => {
    expect(resolveTarget(undefined, at(8, 0))).toBe(at(8, 0));
    expect(resolveTarget("09:00", at(8, 0))).toBe(at(9, 0));
    expect(resolveTarget("09:00", at(9, 5))).toBe(at(9, 5));
  });

  it("resolveDeadline", () => {
    expect(resolveDeadline(undefined, at(9, 0), at(8, 0))).toBeUndefined();
    expect(resolveDeadline("09:30", at(9, 0), at(8, 0))).toBe(at(9, 30));
    expect(resolveDeadline("08:30", at(9, 0), at(8, 0))).toBeUndefined();
  });

  it("prewarmAt", () => {
    expect(prewarmAt(at(9, 0), 60)).toBe(at(8, 59));
  });

  it("nextDelayMs は下限 10 秒 + jitter", () => {
    expect(nextDelayMs(3, 0)).toBe(10_000);
    expect(nextDelayMs(20, 3, () => 0)).toBe(20_000);
    expect(nextDelayMs(20, 3, () => 1)).toBe(23_000);
  });

  it("sleepUntil は 30 秒単位で刻む", async () => {
    const c = fakeClock(at(8, 0));
    await sleepUntil(at(8, 1, 10), c);
    expect(c.sleeps).toEqual([30_000, 30_000, 10_000]);
    expect(c.now()).toBe(at(8, 1, 10));
  });

  it("sleepUntil は時計が飛んでも追従する", async () => {
    let t = at(8, 0);
    let n = 0;
    const c: Clock = {
      now: () => t,
      sleep: async (ms) => {
        n++;
        t += ms + 60_000; // スリープ中に 1 分進んだ
      },
    };
    await sleepUntil(at(8, 2), c);
    expect(n).toBe(2); // 8:01:30 → 8:03:00 で終了 (固定 2 分 sleep なら 4 回)
  });
});

describe("poll", () => {
  const base = { maxAttempts: 5, intervalSec: 20, jitterSec: 0, log: () => undefined };

  it("開始時刻まで待ってから試し、NotOpen の間だけ再試行する", async () => {
    const c = fakeClock(at(8, 59));
    const calls: number[] = [];
    const r = await poll({
      ...base,
      clock: c,
      startAt: at(9, 0),
      attempt: async (n) => {
        calls.push(c.now());
        if (n < 3) throw new NotOpenError("時間外");
        return "ok";
      },
    });
    expect(r).toBe("ok");
    expect(calls).toEqual([at(9, 0), at(9, 0, 20), at(9, 0, 40)]);
  });

  it("max_attempts で諦める", async () => {
    const c = fakeClock(at(9, 0));
    let n = 0;
    await expect(
      poll({ ...base, maxAttempts: 3, clock: c, startAt: at(9, 0), attempt: async () => { n++; throw new NotOpenError("x"); } }),
    ).rejects.toBeInstanceOf(GaveUpError);
    expect(n).toBe(3);
  });

  it("deadline を超える再試行はしない", async () => {
    const c = fakeClock(at(9, 0));
    let n = 0;
    await expect(
      poll({
        ...base,
        maxAttempts: 100,
        clock: c,
        startAt: at(9, 0),
        deadline: at(9, 1),
        attempt: async () => { n++; throw new NotOpenError("x"); },
      }),
    ).rejects.toThrow(/deadline/);
    expect(n).toBe(4); // 9:00:00, :20, :40, 9:01:00
  });

  it("NotOpen 以外は即座に止まる", async () => {
    const c = fakeClock(at(9, 0));
    let n = 0;
    await expect(
      poll({ ...base, clock: c, startAt: at(9, 0), attempt: async () => { n++; throw new ValidationError("bad"); } }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(n).toBe(1);
  });
});
