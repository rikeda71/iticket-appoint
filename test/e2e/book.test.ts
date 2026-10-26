import { rmSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { artifactFiles, assertLocalBaseUrl, configYaml, makeSandbox, MockSite, readLedger, runCli, type Sandbox } from "./helpers.js";

let site: MockSite;
let sb: Sandbox;

beforeAll(async () => {
  site = await MockSite.start();
  // 実サイトに絶対に触れないよう、モックの URL であることを最初に確かめる
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

const SUBMIT = ["book", "--submit", "--yes"];

describe("book (E2E: モックサイト)", () => {
  it("お試し: 確認画面まで到達し、予約は記録されず confirm のスクリーンショットが残る", async () => {
    const r = await runCli(site, sb, ["book"]);
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("確認画面に到達しました");
    expect(r.output).toContain("お試し完了");
    expect(site.bookings).toHaveLength(0);
    expect(site.bookPostCount).toBe(0);
    expect(artifactFiles(sb).some((f) => /-confirm\.png$/.test(f))).toBe(true);
    expect(readLedger(sb)).toHaveLength(0);
  });

  it("本番 --submit --yes: 設定どおりの内容で 1 件予約され、受付番号がログに出て ledger に booked が残る", async () => {
    const r = await runCli(site, sb, SUBMIT);
    expect(r.code, r.output).toBe(0);
    expect(site.bookings).toHaveLength(1);
    const b = site.bookings[0]!;
    expect(b.frameName).toBe("午前");
    expect(b.patients).toEqual([
      { name: "テスト 一郎", cardNo: "10001", birth: "1990-01-02", phone: "09011112222", custom: { 症状: "鼻水" } },
    ]);
    expect(r.output).toContain(`受付番号 ${b.acceptNo}`);
    const ledger = readLedger(sb);
    expect(ledger.at(-1)).toMatchObject({ clinic: "mock", patients: ["a"], status: "booked", accept_no: b.acceptNo });
    expect(artifactFiles(sb).some((f) => /-complete\.png$/.test(f))).toBe(true);
  });

  it("同じ設定で再度 submit: 既に予約済みとして exit 5、予約は増えない", async () => {
    expect((await runCli(site, sb, SUBMIT)).code).toBe(0);
    const r = await runCli(site, sb, SUBMIT);
    expect(r.code, r.output).toBe(5);
    expect(r.stderr).toContain("既に");
    expect(site.bookings).toHaveLength(1);
    expect(site.bookPostCount).toBe(1);
  });

  it("2 人同時 (--patient a,b): 1 件の予約に 2 人分が記録される", async () => {
    const r = await runCli(site, sb, [...SUBMIT, "--patient", "a,b"]);
    expect(r.code, r.output).toBe(0);
    expect(site.bookings).toHaveLength(1);
    expect(site.bookings[0]!.patients.map((p) => [p.name, p.cardNo, p.birth, p.phone])).toEqual([
      ["テスト 一郎", "10001", "1990-01-02", "09011112222"],
      ["テスト 二郎", "10002", "1985-12-31", "09033334444"],
    ]);
    expect(readLedger(sb).at(-1)).toMatchObject({ patients: ["a", "b"], status: "booked" });
  });

  it("受付時間外 --once: exit 2 で予約しない", async () => {
    site.open = false;
    const r = await runCli(site, sb, ["book", "--once"]);
    expect(r.code, r.output).toBe(2);
    expect(site.newBookingAccessCount).toBe(1);
    expect(site.bookings).toHaveLength(0);
  });

  it("全枠 ×: exit 5 で予約しない", async () => {
    site.frames = site.frames.map((f) => ({ ...f, status: "full" }));
    const r = await runCli(site, sb, SUBMIT);
    expect(r.code, r.output).toBe(5);
    expect(r.stderr).toContain("予約できる枠がありません");
    expect(site.bookings).toHaveLength(0);
    expect(site.bookPostCount).toBe(0);
  });

  it("設定にない必須のカスタム項目: exit 3 で予約しない", async () => {
    site.customFields = [{ title: "既往歴", required: true }];
    const r = await runCli(site, sb, SUBMIT);
    expect(r.code, r.output).toBe(3);
    expect(r.stderr).toContain("既往歴");
    expect(site.bookings).toHaveLength(0);
    expect(site.bookPostCount).toBe(0);
    expect(readLedger(sb)).toHaveLength(0);
  });

  it("必須のカスタム項目が設定にあれば入力されて予約できる", async () => {
    site.customFields = [{ title: "既往歴", required: true }];
    sb = makeSandbox(configYaml({ customA: "{ 既往歴: なし }" }));
    const r = await runCli(site, sb, SUBMIT);
    expect(r.code, r.output).toBe(0);
    expect(site.bookings[0]!.patients[0]!.custom).toEqual({ 既往歴: "なし" });
  });

  it("送信後にエラーモーダル: exit 4・予約 POST は 1 回だけ・ledger は attempted、再実行は exit 5", async () => {
    site.bookResponse = "errorModal";
    const r = await runCli(site, sb, SUBMIT);
    expect(r.code, r.output).toBe(4);
    expect(site.bookPostCount).toBe(1);
    expect(site.bookings).toHaveLength(0);
    const ledger = readLedger(sb);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ clinic: "mock", patients: ["a"], status: "attempted" });

    site.bookResponse = "ok";
    const again = await runCli(site, sb, SUBMIT);
    expect(again.code, again.output).toBe(5);
    expect(site.bookPostCount).toBe(1);
    expect(site.bookings).toHaveLength(0);
  });

  it("--frame 午後: 指定した枠で予約される", async () => {
    const r = await runCli(site, sb, [...SUBMIT, "--frame", "午後"]);
    expect(r.code, r.output).toBe(0);
    expect(site.bookings).toHaveLength(1);
    expect(site.bookings[0]).toMatchObject({ frameId: "12", frameName: "午後" });
  });

  it("存在しない枠名 (--frame 深夜): exit 3 で予約しない", async () => {
    const r = await runCli(site, sb, [...SUBMIT, "--frame", "深夜"]);
    expect(r.code, r.output).toBe(3);
    expect(site.bookings).toHaveLength(0);
  });
});
