import { execFile } from "node:child_process";

/**
 * 結果をスマホ等に通知する。NOTIFY_URL が
 *  - Discord webhook (discord.com/api/webhooks/...) なら content を JSON POST
 *  - それ以外 (ntfy.sh/<topic> など) なら「タイトル改行本文」をそのまま POST
 * 未設定なら何もしない。macOS ローカル実行時は通知センターにも出す。
 * 通知の失敗で予約処理を失敗扱いにはしない。
 */
export async function notify(title: string, body: string, log: (m: string) => void = console.error): Promise<void> {
  const url = process.env.NOTIFY_URL;
  if (url) {
    try {
      const isDiscord = /discord(app)?\.com\/api\/webhooks\//.test(url);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": isDiscord ? "application/json" : "text/plain; charset=utf-8" },
        body: isDiscord ? JSON.stringify({ content: `**${title}**\n${body}` }) : `${title}\n${body}`,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) log(`通知に失敗しました: HTTP ${res.status}`);
    } catch (e) {
      log(`通知に失敗しました: ${(e as Error).message}`);
    }
  }
  if (process.platform === "darwin" && !process.env.CI) {
    const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    await new Promise<void>((resolve) => {
      execFile("osascript", ["-e", `display notification "${esc(body)}" with title "${esc(title)}"`], () => resolve());
    });
  }
}
