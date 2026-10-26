import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";

/**
 * 実行ごとの記録 (artifacts/<timestamp>/)。スクリーンショット・HTML には個人情報が含まれるので
 * リポジトリには入れない (.gitignore 済み)。
 * ITICKET_REDACT=1 (public リポジトリの Actions 用) では、個人情報が写る画面と本文を保存しない。
 */
export class Artifacts {
  readonly dir: string;
  readonly redact = process.env.ITICKET_REDACT === "1";
  private step = 0;

  constructor(root = process.env.ITICKET_ARTIFACTS ?? "artifacts", now = new Date()) {
    const p = (n: number) => String(n).padStart(2, "0");
    const ts = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
    this.dir = join(root, ts);
    mkdirSync(this.dir, { recursive: true });
  }

  log(msg: string): void {
    const line = `${new Date().toISOString()} ${msg}`;
    console.error(msg);
    appendFileSync(join(this.dir, "run.log"), line + "\n");
  }

  /** 個人情報を含む内容 (確認画面の本文など)。CI のジョブログには出さず run.log だけに書く (redact 時は書かない) */
  logFile(msg: string): void {
    if (this.redact) return;
    if (!process.env.CI) console.error(msg);
    appendFileSync(join(this.dir, "run.log"), `${new Date().toISOString()} ${msg}\n`);
  }

  /**
   * NN-<name>.png / .html を保存する。保存の失敗は本処理に影響させない。
   * personal = 入力値が写る画面 (入力・確認・完了など)。redact 時は保存しない
   */
  async capture(page: Page, name: string, o: { personal?: boolean } = {}): Promise<string | undefined> {
    if (o.personal && this.redact) {
      this.log(`個人情報を含むため ${name} の画面は保存しません (ITICKET_REDACT=1)`);
      return undefined;
    }
    const base = join(this.dir, `${String(++this.step).padStart(2, "0")}-${name}`);
    try {
      writeFileSync(`${base}.html`, await page.content());
      await page.screenshot({ path: `${base}.png`, fullPage: true, timeout: 10_000 });
      return `${base}.png`;
    } catch (e) {
      this.log(`記録に失敗しました (${name}): ${(e as Error).message}`);
      return undefined;
    }
  }
}
