import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertLocalBaseUrl, makeSandbox, MockSite, readLedger, runCli, startCli, type Sandbox } from "./helpers.js";

let site: MockSite;
let sb: Sandbox;

beforeAll(async () => {
  site = await MockSite.start();
  assertLocalBaseUrl(site.baseUrl);
});
afterAll(async () => {
  await site.stop();
});
beforeEach(() => {
  site.reset();
  sb = makeSandbox();
});
afterEach(() => {
  rmSync(sb.dir, { recursive: true, force: true });
});

// CI・ヘッドレス環境でも動くよう、テストでは headed 強制を外す (ITICKET_KEEP_OPEN_HEADLESS)
const ENV = { ITICKET_KEEP_OPEN_HEADLESS: "1" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, ms = 60_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("条件を満たしませんでした");
    await sleep(100);
  }
}

describe("book --keep-open (E2E: モックサイト)", () => {
  it("確認画面でブラウザを残して待機し、Ctrl-C で exit 0。予約は記録されず lock も解放される", async () => {
    const cli = startCli(site, sb, ["book", "--keep-open"], 90_000, ENV);
    await until(() => cli.output().includes("ブラウザを閉じるまで待機します"));
    expect(cli.output()).toContain("確認画面に到達しました");
    expect(cli.output()).toContain("セッションは約 60 分で切れます");
    expect(existsSync(join(sb.state, "mock.lock"))).toBe(true);
    // 待機中は終了しない
    await sleep(1500);
    expect(cli.child.exitCode).toBeNull();

    cli.child.kill("SIGINT");
    const r = await cli.done;
    expect(r.code, r.output).toBe(0);
    expect(site.bookPostCount).toBe(0);
    expect(site.bookings).toHaveLength(0);
    expect(readLedger(sb)).toHaveLength(0);
    expect(existsSync(join(sb.state, "mock.lock"))).toBe(false);
  });

  it("--submit との併用は exit 3 でブラウザを起動しない", async () => {
    const r = await runCli(site, sb, ["book", "--keep-open", "--submit", "--yes"], 90_000, ENV);
    expect(r.code, r.output).toBe(3);
    expect(r.stderr).toContain("--keep-open");
    expect(site.newBookingAccessCount).toBe(0);
  });

  it("受付前は通常どおり再試行し、受付開始後に確認画面で待機する", async () => {
    site.open = false;
    site.openAt = Date.now() + 8_000;
    const cli = startCli(site, sb, ["book", "--keep-open", "--wait-until", "now", "--max-attempts", "3"], 90_000, ENV);
    await until(() => cli.output().includes("ブラウザを閉じるまで待機します"));
    expect(cli.output()).toContain("受付前");
    cli.child.kill("SIGINT");
    const r = await cli.done;
    expect(r.code, r.output).toBe(0);
    expect(site.bookings).toHaveLength(0);
  });
});
