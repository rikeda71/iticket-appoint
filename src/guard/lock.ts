import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AppError } from "../flow/errors.js";

export class LockedError extends AppError {}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** 同じ医院に対する多重起動を防ぐ。取得できなければ LockedError */
export function acquireLock(stateDir: string, name: string): () => void {
  mkdirSync(stateDir, { recursive: true });
  const path = join(stateDir, `${name}.lock`);
  for (let i = 0; i < 2; i++) {
    try {
      writeFileSync(path, String(process.pid), { flag: "wx" });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try {
          unlinkSync(path);
        } catch {
          // 既に消えていれば何もしない
        }
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const pid = Number(readFileSync(path, "utf8").trim());
      if (Number.isInteger(pid) && pid > 0 && isAlive(pid)) {
        throw new LockedError(`別のプロセス (pid ${pid}) が実行中です: ${path}`);
      }
      unlinkSync(path); // 異常終了で残ったロック
    }
  }
  throw new LockedError(`ロックを取得できません: ${path}`);
}
