import { chromium, type Browser, type BrowserContext } from "playwright";
import type { BrowserConfig } from "../config/schema.js";

export interface SessionOptions extends BrowserConfig {
  trace?: boolean;
}

/** 画像・フォント・広告などは読み込まない (サイト負荷と待ち時間の削減) */
const BLOCKED_TYPES = new Set(["image", "font", "media"]);
const BLOCKED_HOSTS = /(googletagmanager|google-analytics|doubleclick|googlesyndication|securepubads|adservice)\./;

export async function launchBrowser(o: SessionOptions): Promise<Browser> {
  return chromium.launch({ headless: o.headless });
}

/**
 * 予約 1 回分のコンテキスト。予約状態はクライアント側に保持され、セッションは 3600 秒で切れるので、
 * 試行ごとに作り直す。
 */
export async function newBookingContext(browser: Browser, o: SessionOptions): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    viewport: { width: 1280, height: 900 },
  });
  ctx.setDefaultTimeout(o.timeout_ms);
  ctx.setDefaultNavigationTimeout(Math.max(o.timeout_ms, 30_000));
  await ctx.route("**/*", (route) => {
    const req = route.request();
    if (BLOCKED_TYPES.has(req.resourceType()) || BLOCKED_HOSTS.test(new URL(req.url()).hostname)) {
      return route.abort();
    }
    return route.continue();
  });
  if (o.trace) await ctx.tracing.start({ screenshots: true, snapshots: true });
  return ctx;
}

export async function closeContext(ctx: BrowserContext, tracePath?: string): Promise<void> {
  if (tracePath) {
    try {
      await ctx.tracing.stop({ path: tracePath });
    } catch {
      // tracing 未開始
    }
  }
  await ctx.close().catch(() => undefined);
}
