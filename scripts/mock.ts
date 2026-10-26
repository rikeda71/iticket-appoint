/**
 * ダミーの HTML (E2E 用モックサイト) に対して book を実行する。実サイトには一切アクセスしない。
 *
 *   pnpm mock                          # 患者 a でお試し (確認画面で止まる)
 *   pnpm mock --patient a,b --headed   # 2 人・ブラウザ表示
 *   pnpm mock --submit --yes           # モック相手に「予約する」まで押す
 *   pnpm mock --serve                  # モックサイトだけ起動 (Ctrl-C で終了)
 *
 * 設定はダミー患者 a / b の config (test/e2e/helpers.ts) を使い、予約記録 (state) は毎回使い捨て。
 * スクリーンショット等は artifacts/mock/ に保存する。
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertLocalBaseUrl, configYaml, MockSite } from "../test/e2e/helpers.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const serve = args.includes("--serve");
const dir = mkdtempSync(join(tmpdir(), "iticket-mock-"));
const configPath = join(dir, "config.yaml");
writeFileSync(configPath, configYaml());

const site = await MockSite.start();
assertLocalBaseUrl(site.baseUrl);
const cleanup = async () => {
  await site.stop();
  rmSync(dir, { recursive: true, force: true });
};

if (serve) {
  console.error(`モックサイト: ${site.baseUrl}/clinics/1/businesses/01`);
  console.error(
    `別のターミナルで: ITICKET_BASE_URL=${site.baseUrl} ITICKET_ARTIFACTS=artifacts/mock ITICKET_STATE=${join(dir, "state")} pnpm cli -c ${configPath} book --wait-until now --once`,
  );
  console.error("Ctrl-C で終了します");
  process.once("SIGINT", () => void cleanup().then(() => process.exit(0)));
} else {
  const bookArgs = ["book", ...args];
  if (!args.some((a) => a.startsWith("--wait-until"))) bookArgs.push("--wait-until", "now");
  if (!args.some((a) => a === "--once" || a.startsWith("--max-attempts"))) bookArgs.push("--once");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ITICKET_BASE_URL: site.baseUrl,
    ITICKET_ARTIFACTS: join("artifacts", "mock"),
    ITICKET_STATE: join(dir, "state"),
  };
  delete env.NOTIFY_URL;
  delete env.CI;
  console.error(`モックサイト (${site.baseUrl}) に対して実行します: ${bookArgs.join(" ")}\n`);
  const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "-c", configPath, ...bookArgs], {
    env,
    stdio: "inherit",
  });
  const code = await new Promise<number>((resolve) => child.on("exit", (c) => resolve(c ?? 1)));
  console.error(`\nモックへの「予約する」送信: ${site.bookPostCount} 回`);
  await cleanup();
  process.exitCode = code;
}
