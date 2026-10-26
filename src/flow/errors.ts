export const ExitCode = {
  ok: 0,
  other: 1,
  notOpen: 2,
  validation: 3,
  unknownOutcome: 4,
  alreadyDone: 5,
} as const;

export class AppError extends Error {
  readonly exitCode: number = ExitCode.other;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConfigError extends AppError {
  override readonly exitCode = ExitCode.validation;
}

/** 受付がまだ始まっていない / 時間外。待機モードではリトライ対象 */
export class NotOpenError extends AppError {
  override readonly exitCode = ExitCode.notOpen;
}

/** 受付終了・満枠 */
export class FullError extends AppError {
  override readonly exitCode = ExitCode.alreadyDone;
}

/** 既に予約済み (ledger またはサイトの重複エラー) */
export class AlreadyBookedError extends AppError {
  override readonly exitCode = ExitCode.alreadyDone;
}

/** 入力内容の不備。設定を直さない限り成功しないのでリトライしない */
export class ValidationError extends AppError {
  override readonly exitCode = ExitCode.validation;
}

export class MissingValueError extends ValidationError {}

/** 予約ボタン押下後に結果が確認できなかった。二重予約を避けるため再送しない */
export class UnknownOutcomeError extends AppError {
  override readonly exitCode = ExitCode.unknownOutcome;
}

/** 待機モードで max_attempts / deadline に達した */
export class GaveUpError extends AppError {
  override readonly exitCode = ExitCode.notOpen;
}

export function exitCodeOf(err: unknown): number {
  return err instanceof AppError ? err.exitCode : ExitCode.other;
}
