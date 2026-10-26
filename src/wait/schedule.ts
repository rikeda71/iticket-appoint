import { HHMM_RE } from "../config/schema.js";

export const MIN_INTERVAL_SEC = 10;
/** 長い sleep を分割する単位。スリープ復帰や時計補正があっても目標時刻に追従するため */
export const SLEEP_CHUNK_MS = 30_000;

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/** 今日 (ローカルタイムゾーン) の HH:MM の epoch ms */
export function todayAt(hhmm: string, nowMs: number): number {
  if (!HHMM_RE.test(hhmm)) throw new Error(`HH:MM 形式ではありません: ${hhmm}`);
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const d = new Date(nowMs);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

/** 待機の目標時刻。既に過ぎていれば即時 (同日予約のみなので翌日には繰り越さない) */
export function resolveTarget(waitUntil: string | undefined, nowMs: number): number {
  if (!waitUntil) return nowMs;
  return Math.max(todayAt(waitUntil, nowMs), nowMs);
}

/** 締め切り時刻。開始時刻を既に過ぎている (例: 締め切り後の手動実行) なら締め切りなしとして扱う */
export function resolveDeadline(deadline: string | undefined, target: number, nowMs: number): number | undefined {
  if (!deadline) return undefined;
  const d = todayAt(deadline, nowMs);
  return d > target ? d : undefined;
}

export function prewarmAt(target: number, prewarmSec: number): number {
  return target - prewarmSec * 1000;
}

/** 次の試行までの待ち時間。interval は下限 10 秒に丸め、0..jitter 秒をランダムに足す */
export function nextDelayMs(intervalSec: number, jitterSec: number, rand: () => number = Math.random): number {
  const base = Math.max(MIN_INTERVAL_SEC, intervalSec) * 1000;
  return base + Math.round(rand() * jitterSec * 1000);
}

export async function sleepUntil(targetMs: number, clock: Clock, chunkMs = SLEEP_CHUNK_MS): Promise<void> {
  for (;;) {
    const rest = targetMs - clock.now();
    if (rest <= 0) return;
    await clock.sleep(Math.min(rest, chunkMs));
  }
}

export function formatTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
