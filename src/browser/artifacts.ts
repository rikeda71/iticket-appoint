import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";

/**
 * 実行ごとの記録 (artifacts/<timestamp>/)。スクリーンショット・HTML には個人情報が含まれるので
 * リポジトリには入れない (.gitignore 済み)。
 */
export class Artifacts {
  readonly dir: string;
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

  /** 個人情報を含む内容 (確認画面の本文など)。CI のジョブログには出さず run.log だけに書く */
  logFile(msg: string): void {
    if (!process.env.CI) console.error(msg);
    appendFileSync(join(this.dir, "run.log"), `${new Date().toISOString()} ${msg}\n`);
  }

  /** NN-<name>.png / .html を保存する。保存の失敗は本処理に影響させない */
  async capture(page: Page, name: string): Promise<string | undefined> {
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
