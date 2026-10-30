import { createInterface } from "node:readline/promises";
import type { Browser, Page } from "playwright";
import { Artifacts } from "../browser/artifacts.js";
import { waitForClose } from "../browser/keep-open.js";
import { launchBrowser } from "../browser/session.js";
import { loadConfig, resolveProfiles } from "../config/load.js";
import { attemptBooking, type BookResult } from "../flow/book-flow.js";
import {
  AlreadyBookedError,
  AppError,
  ConfigError,
  FullError,
  GaveUpError,
  UnknownOutcomeError,
} from "../flow/errors.js";
import { Ledger, localDate } from "../guard/ledger.js";
import { acquireLock } from "../guard/lock.js";
import { notify } from "../notify.js";
import { businessTopUrl } from "../site/urls.js";
import { poll } from "../wait/poller.js";
import {
  formatTime,
  prewarmAt,
  resolveDeadline,
  resolveTarget,
  sleepUntil,
  systemClock,
  type Clock,
} from "../wait/schedule.js";

export interface BookOptions {
  config: string;
  clinic?: string;
  patient?: string[];
  frame?: string;
  submit?: boolean;
  yes?: boolean;
  waitUntil?: string;
  interval?: number;
  maxAttempts?: number;
  deadline?: string;
  once?: boolean;
  headed?: boolean;
  keepOpen?: boolean;
  trace?: boolean;
  force?: boolean;
}

const STATE_DIR = process.env.ITICKET_STATE ?? "state";

async function confirmSubmit(summary: string): Promise<void> {
  if (!process.stdin.isTTY) throw new ConfigError("--submit を非対話で使うときは --yes を付けてください");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const ans = await rl.question(`${summary}\n本当に予約しますか? [y/N] `);
    if (!/^y(es)?$/i.test(ans.trim())) throw new AppError("中止しました");
  } finally {
    rl.close();
  }
}

function failureTitle(e: unknown): string {
  if (e instanceof UnknownOutcomeError) return "iticket 結果不明: 予約できたか確認して (再実行しないで)";
  if (e instanceof AlreadyBookedError) return "iticket 予約済み";
  if (e instanceof FullError) return "iticket 満枠・受付終了";
  if (e instanceof GaveUpError) return "iticket 受付が始まらず終了";
  return "iticket 予約失敗";
}

export async function book(o: BookOptions, clock: Clock = systemClock): Promise<number> {
  const cfg = loadConfig(o.config);
  const { clinicKey, clinic, patients } = resolveProfiles(cfg, {
    ...(o.clinic ? { clinic: o.clinic } : {}),
    ...(o.patient ? { patients: o.patient } : {}),
  });
  const frame = o.frame ?? clinic.frame;
  const submit = o.submit ?? false;
  if (o.keepOpen && submit) throw new ConfigError("--keep-open は --submit と同時に使えません (お試し専用です)");
  // --keep-open は画面を見て手動で操作するので headed にする (ITICKET_KEEP_OPEN_HEADLESS=1 はテスト用)
  const forceHeaded = o.headed || (o.keepOpen && !process.env.ITICKET_KEEP_OPEN_HEADLESS);
  const headless = forceHeaded ? false : cfg.browser.headless;
  const wait = {
    interval: o.interval ?? cfg.wait.interval_sec,
    maxAttempts: o.once ? 1 : (o.maxAttempts ?? cfg.wait.max_attempts),
    deadline: o.deadline ?? cfg.wait.deadline,
  };
  if (wait.interval < 10) throw new ConfigError("--interval は 10 秒以上にしてください (サイト負荷への配慮)");
  const waitUntil = o.waitUntil === "now" ? undefined : (o.waitUntil ?? cfg.defaults.wait_until);

  const now = clock.now();
  const target = resolveTarget(waitUntil, now);
  const deadline = resolveDeadline(wait.deadline, target, now);
  const names = patients.map((p) => p.key).join(", ");
  const summary = [
    `医院: ${clinic.name ?? clinicKey} (${businessTopUrl(clinic)})`,
    `患者: ${names} (${patients.length} 人)${frame ? ` / 枠: ${frame}` : ""}`,
    `開始: ${formatTime(target)}${deadline ? ` / 締切: ${formatTime(deadline)}` : ""} / 最大 ${wait.maxAttempts} 回・${wait.interval} 秒間隔`,
    `モード: ${submit ? "本番 (予約する)" : o.keepOpen ? "お試し (確認画面でブラウザを残す)" : "お試し (確認画面で停止)"}`,
  ].join("\n");
  console.error(summary);

  if (submit && !o.yes) await confirmSubmit(summary);

  const release = acquireLock(STATE_DIR, clinicKey);
  const ledger = new Ledger(STATE_DIR);
  const patientKeys = patients.map((p) => p.key);
  const prior = ledger.findBooked(localDate(target), clinicKey, patientKeys);
  if (submit && prior && !o.force) {
    release();
    throw new AlreadyBookedError(
      `本日は既に${prior.status === "attempted" ? "予約ボタンを押した (結果未確認の)" : "予約済みの"}記録があります (${prior.patients.join(", ")}${prior.accept_no ? ` 受付番号 ${prior.accept_no}` : ""})。予約状況を確認し、それでも再実行するなら --force`,
    );
  }
  // --keep-open の待機中は Ctrl-C で待機だけを終え、通常どおり後片付けして終了する
  const stopWait = new AbortController();
  let waiting = false;
  const onSignal = () => {
    if (waiting) {
      stopWait.abort();
      return;
    }
    release();
    // Playwright 既定のシグナル処理は無効にしてあるので、ブラウザは自分で閉じてから終了する
    void (browser?.close().catch(() => undefined) ?? Promise.resolve()).finally(() => process.exit(130));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const art = new Artifacts();
  art.log(`記録先: ${art.dir}`);
  let browser: Browser | undefined;
  try {
    const warm = prewarmAt(target, cfg.wait.prewarm_sec);
    if (warm > clock.now()) art.log(`${formatTime(warm)} まで待機してからブラウザを起動します`);
    await sleepUntil(warm, clock);
    browser = await launchBrowser({ ...cfg.browser, headless });
    const b = browser;
    const result: BookResult = await poll({
      startAt: target,
      ...(deadline !== undefined ? { deadline } : {}),
      maxAttempts: wait.maxAttempts,
      intervalSec: wait.interval,
      jitterSec: cfg.wait.jitter_sec,
      clock,
      log: (m) => art.log(m),
      attempt: (n) => {
        art.log(`[${n}] ${formatTime(clock.now())} 予約を試みます`);
        return attemptBooking(
          b,
          {
            clinic,
            patients,
            ...(frame ? { frame } : {}),
            submit,
            session: {
              ...cfg.browser,
              headless,
              ...(o.trace ? { trace: true } : {}),
            },
            artifacts: art,
            ...(o.keepOpen
              ? {
                  onConfirm: async (page: Page) => {
                    waiting = true;
                    try {
                      await notify("iticket 確認画面に到達", `${names}: ブラウザを残して待機中`, (m) => art.log(m));
                      art.log(
                        "ブラウザを閉じるまで待機します (Ctrl-C でも終了)。予約するなら画面の「予約する」を押してください (セッションは約 60 分で切れます)。手動での予約は ledger に記録されません",
                      );
                      await waitForClose(page, stopWait.signal);
                    } finally {
                      waiting = false;
                    }
                  },
                }
              : {}),
            onSubmit: () =>
              ledger.record({
                date: localDate(clock.now()),
                clinic: clinicKey,
                patients: patientKeys,
                status: "attempted",
                at: new Date(clock.now()).toISOString(),
              }),
          },
          n,
        );
      },
    });

    if (result.kind === "dry-run") {
      art.log(`お試し完了: 確認画面まで進みました (枠: ${result.frame.name})`);
      art.logFile(result.confirmText);
      if (o.keepOpen) {
        art.log("待機を終了します");
        return 0;
      }
      art.log("本当に予約するには --submit を付けてください");
      await notify("iticket お試し完了", `${names}: 確認画面まで到達 (${result.frame.name})`, (m) => art.log(m));
      return 0;
    }
    ledger.record({
      date: localDate(clock.now()),
      clinic: clinicKey,
      patients: patientKeys,
      status: "booked",
      ...(result.acceptNo ? { accept_no: result.acceptNo } : {}),
      at: new Date(clock.now()).toISOString(),
    });
    const msg = `${names}: 予約しました (${result.frame.name})${result.acceptNo ? ` 受付番号 ${result.acceptNo}` : " (受付番号は読み取れませんでした。完了画面を確認してください)"}`;
    art.log(msg);
    if (result.acceptNo) {
      art.logFile(result.text);
      art.log(`受付番号: ${result.acceptNo}`);
    } else {
      // 受付番号が取れなくても予約は成立している。本人が読めるよう完了画面の本文と記録先を出す
      art.log("受付番号を完了画面から読み取れませんでした (予約自体は完了しています)");
      if (art.redact) {
        art.log("ITICKET_REDACT=1 のため完了画面の本文は出力・保存しません。医院に直接確認してください");
      } else {
        art.log(`完了画面の本文: ${result.text.length > 1500 ? `${result.text.slice(0, 1500)}…` : result.text}`);
        art.log(
          result.screenshot
            ? `完了画面の記録: ${result.screenshot} (同名の .html もあります)`
            : `完了画面の記録は ${art.dir} を確認してください`,
        );
      }
    }
    await notify("iticket 予約完了", msg, (m) => art.log(m));
    return 0;
  } catch (e) {
    const err = e as Error;
    art.log(`失敗: ${err.message}`);
    await notify(failureTitle(e), `${names}: ${err.message}`, (m) => art.log(m));
    throw e;
  } finally {
    await browser?.close().catch(() => undefined);
    release();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}
