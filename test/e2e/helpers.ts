import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { LedgerEntry } from "../../src/guard/ledger.js";
import { MockSite } from "./mock-site/server.js";

export { MockSite };

const REPO_ROOT = resolve(new URL("../..", import.meta.url).pathname);

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** stdout + stderr (ログは主に stderr) */
  output: string;
}

export interface Sandbox {
  dir: string;
  configPath: string;
  artifacts: string;
  state: string;
}

/** モック以外 (外部サイト) に向けて CLI を走らせないためのガード */
export function assertLocalBaseUrl(url: string): void {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/park2$/.test(url)) {
    throw new Error(`E2E は 127.0.0.1 のモックにのみ接続できます: ${url}`);
  }
}

export interface YamlOptions {
  maxAttempts?: number;
  /** a の custom_fields (YAML のフローマップ文字列) */
  customA?: string;
}

/** ダミー個人情報のみの設定 YAML */
export function configYaml(o: YamlOptions = {}): string {
  return `defaults:
  clinic: mock
  patients: [a]
clinics:
  mock:
    owner_id: "1"
    business_no: "01"
    name: モック医院
patients:
  a:
    name: テスト 一郎
    patient_card_no: "10001"
    birth: "1990-01-02"
    phone: "090-1111-2222"
    custom_fields: ${o.customA ?? "{ 症状: 鼻水 }"}
  b:
    name: テスト 二郎
    patient_card_no: "10002"
    birth: "1985-12-31"
    phone: "090-3333-4444"
wait:
  interval_sec: 10
  jitter_sec: 0
  prewarm_sec: 0
  max_attempts: ${o.maxAttempts ?? 1}
browser:
  headless: true
  timeout_ms: 15000
`;
}

export function makeSandbox(yaml: string = configYaml()): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), "iticket-e2e-"));
  const configPath = join(dir, "config.yaml");
  const artifacts = join(dir, "artifacts");
  const state = join(dir, "state");
  writeFileSync(configPath, yaml);
  mkdirSync(artifacts);
  return { dir, configPath, artifacts, state };
}

/** CLI を子プロセスで実行する (モックはこのプロセスで動いているので同期実行しない) */
export function runCli(site: MockSite, sb: Sandbox, args: string[], timeoutMs = 90_000): Promise<CliResult> {
  assertLocalBaseUrl(site.baseUrl);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ITICKET_BASE_URL: site.baseUrl,
    ITICKET_ARTIFACTS: sb.artifacts,
    ITICKET_STATE: sb.state,
    CI: "1",
  };
  delete env.NOTIFY_URL;
  delete env.ITICKET_CONFIG;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", "-c", sb.configPath, ...args], { cwd: REPO_ROOT, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`CLI がタイムアウトしました (${timeoutMs}ms)\n${stderr}`));
    }, timeoutMs);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code, stdout, stderr, output: stdout + stderr });
    });
  });
}

export function readLedger(sb: Sandbox): LedgerEntry[] {
  try {
    return readFileSync(join(sb.state, "ledger.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as LedgerEntry);
  } catch {
    return [];
  }
}

/** artifacts/<timestamp>/ 配下のファイル名一覧 */
export function artifactFiles(sb: Sandbox): string[] {
  return readdirSync(sb.artifacts, { recursive: true }).map(String);
}
