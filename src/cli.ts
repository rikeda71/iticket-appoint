import { Command, InvalidArgumentError, Option } from "commander";
import { defaultConfigPath } from "./config/load.js";
import { book } from "./commands/book.js";
import { checkConfig } from "./commands/check-config.js";
import { status } from "./commands/status.js";
import { exitCodeOf } from "./flow/errors.js";
import { HHMM_RE } from "./config/schema.js";

const int = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError("正の整数を指定してください");
  return n;
};
const hhmm = (allowNow: boolean) => (v: string) => {
  if (allowNow && v === "now") return v;
  if (!HHMM_RE.test(v)) throw new InvalidArgumentError(`HH:MM 形式で指定してください${allowNow ? " (now も可)" : ""}`);
  return v;
};
const collect = (v: string, prev: string[] = []) => [...prev, v];

const program = new Command()
  .name("iticket")
  .description("アイチケット広場の予約を事前登録した情報で行う")
  .option("-c, --config <path>", "設定ファイル", defaultConfigPath());

const configPath = () => program.opts<{ config: string }>().config;

program
  .command("check-config")
  .description("設定ファイルを検証して表示 (個人情報はマスク)")
  .action(() => checkConfig(configPath()));

program
  .command("status")
  .description("診療状態と当日枠を表示 (読み取りのみ)")
  .option("--clinic <key>", "医院")
  .option("--save-fixture", "テスト用に HTML を保存")
  .option("--headed", "ブラウザを表示")
  .action((o: { clinic?: string; saveFixture?: boolean; headed?: boolean }) => status({ config: configPath(), ...o }));

program
  .command("book")
  .description("予約する (既定はお試し: 確認画面で止まる)")
  .option("--clinic <key>", "医院 (省略時 defaults.clinic)")
  .option("--patient <key>", "患者 (複数回指定・カンマ区切り可。省略時 defaults.patients)", collect)
  .option("--frame <text>", "枠名の部分一致 (例: 午前)")
  .option("--submit", "実際に「予約する」を押す")
  .option("-y, --yes", "--submit の確認プロンプトを省略")
  .option("--wait-until <HH:MM|now>", "この時刻まで待ってから開始", hhmm(true))
  .option("--interval <sec>", "受付前の再試行間隔 (10 秒以上)", int)
  .option("--max-attempts <n>", "最大試行回数", int)
  .option("--deadline <HH:MM>", "この時刻を過ぎたら諦める", hhmm(false))
  .addOption(new Option("--once", "再試行しない (1 回だけ)").conflicts("maxAttempts"))
  .option("--headed", "ブラウザを表示")
  .option("--keep-open", "確認画面でブラウザを残し、閉じるまで待つ (お試し専用・headed になる)")
  .option("--trace", "Playwright trace を保存")
  .option("--force", "同じ日の予約記録があっても実行")
  .action(async (o: Omit<Parameters<typeof book>[0], "config">) => {
    await book({ config: configPath(), ...o });
  });

try {
  await program.parseAsync();
} catch (e) {
  console.error(`エラー: ${(e as Error).message}`);
  process.exitCode = exitCodeOf(e);
}
