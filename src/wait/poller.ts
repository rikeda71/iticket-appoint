import { GaveUpError, NotOpenError } from "../flow/errors.js";
import { formatTime, nextDelayMs, sleepUntil, type Clock } from "./schedule.js";

export interface PollOptions<T> {
  /** 1 回分の試行。NotOpenError を投げたときだけ再試行する */
  attempt: (n: number) => Promise<T>;
  /** 最初の試行時刻 (epoch ms) */
  startAt: number;
  deadline?: number;
  maxAttempts: number;
  intervalSec: number;
  jitterSec: number;
  clock: Clock;
  log: (msg: string) => void;
  rand?: () => number;
}

export async function poll<T>(o: PollOptions<T>): Promise<T> {
  await sleepUntil(o.startAt, o.clock);
  for (let n = 1; ; n++) {
    try {
      return await o.attempt(n);
    } catch (e) {
      if (!(e instanceof NotOpenError)) throw e;
      if (n >= o.maxAttempts) {
        throw new GaveUpError(`${n} 回試しましたが受付が始まりませんでした (${e.message})`);
      }
      const next = o.clock.now() + nextDelayMs(o.intervalSec, o.jitterSec, o.rand);
      if (o.deadline !== undefined && next > o.deadline) {
        throw new GaveUpError(`deadline ${formatTime(o.deadline)} までに受付が始まりませんでした (${e.message})`);
      }
      o.log(`[${n}/${o.maxAttempts}] 受付前: ${e.message} → ${formatTime(next)} に再試行`);
      await sleepUntil(next, o.clock);
    }
  }
}
