import { rmSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertLocalBaseUrl, makeSandbox, MockSite, readLedger, runCli, type Sandbox } from "./helpers.js";

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

describe("book 待機モード (E2E: モックサイト)", () => {
  it("受付前は再試行し、受付開始後の試行で予約できる (interval 10 秒)", async () => {
    site.open = false;
    // CLI 起動 + ブラウザ起動の後の 1 回目は受付前、10 秒後の 2 回目は受付中になる
    site.openAt = Date.now() + 8_000;
    const r = await runCli(site, sb, ["book", "--submit", "--yes", "--wait-until", "now", "--max-attempts", "3"]);
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("受付前");
    expect(site.newBookingAccessCount).toBeGreaterThanOrEqual(2);
    expect(site.bookings).toHaveLength(1);
    expect(readLedger(sb).at(-1)).toMatchObject({ status: "booked" });
  });

  it("受付が始まらないまま max-attempts に達したら exit 2", async () => {
    site.open = false;
    const r = await runCli(site, sb, ["book", "--wait-until", "now", "--max-attempts", "2"]);
    expect(r.code, r.output).toBe(2);
    expect(site.newBookingAccessCount).toBe(2);
    expect(site.bookings).toHaveLength(0);
  });
});
