import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface LedgerEntry {
  /** 受診日 YYYY-MM-DD (ローカル) */
  date: string;
  clinic: string;
  patients: string[];
  accept_no?: string;
  /** booked = 完了画面を確認 / attempted = 「予約する」を押したが結果未確認 (どちらも再実行を止める) */
  status?: "booked" | "attempted";
  at: string;
}

export function localDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export class Ledger {
  readonly path: string;
  constructor(stateDir: string) {
    this.path = join(stateDir, "ledger.jsonl");
  }

  entries(): LedgerEntry[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as LedgerEntry];
        } catch {
          return [];
        }
      });
  }

  /** 同じ日・医院で、指定患者のいずれかが予約済み (または送信済みで結果不明) ならそのエントリを返す */
  findBooked(date: string, clinic: string, patients: string[]): LedgerEntry | undefined {
    return this.entries().find((e) => e.date === date && e.clinic === clinic && e.patients.some((p) => patients.includes(p)));
  }

  record(entry: LedgerEntry): void {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, JSON.stringify(entry) + "\n");
  }
}
