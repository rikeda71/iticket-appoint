import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * アイチケット広場の予約フローを模したモックサイト (外部ネットワーク不要)。
 * 実サイトと同じ URL 構造で、受付時間外の /bookings/new は TOP へ 307 で戻す。
 * 状態 (open / frames / bookResponse ...) はテストからプロパティで制御する。
 */

export type FrameStatus = "ok" | "full" | "out-of-period";
export type BookResponse = "ok" | "errorModal" | "hang";

export interface MockFrame {
  id: string;
  name: string;
  range: string;
  wait: string;
  status: FrameStatus;
}

export interface CustomField {
  title: string;
  required: boolean;
}

export interface MockBookedPatient {
  name: string;
  cardNo: string;
  /** YYYY-MM-DD */
  birth: string;
  phone: string;
  /** 医院独自項目: タイトル -> 値 */
  custom: Record<string, string>;
}

export interface MockBooking {
  date: string;
  frameId: string;
  frameName: string;
  acceptNo: string;
  patients: MockBookedPatient[];
}

const CLIENT_JS = readFileSync(new URL("./client.js", import.meta.url), "utf8");

const defaultFrames = (): MockFrame[] => [
  { id: "11", name: "午前", range: "(09:00 - 12:30)", wait: "現在 3人 待ち", status: "ok" },
  { id: "12", name: "午後", range: "(15:00 - 18:00)", wait: "現在 5人 待ち", status: "ok" },
  { id: "13", name: "夜", range: "(19:00 - 21:00)", wait: "", status: "out-of-period" },
];

const localDate8 = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

export class MockSite {
  /** 受付中か */
  open = true;
  /** この時刻 (epoch ms) 以降は受付中になる (open が false のときのみ意味を持つ) */
  openAt: number | undefined;
  frames: MockFrame[] = defaultFrames();
  /** 「予約する」(POST /mock/api/book) への応答 */
  bookResponse: BookResponse = "ok";
  errorMessage = "サーバーエラーが発生しました。時間を空けて再度お試しください。";
  /** 医院独自の入力項目 (診察券・氏名・生年月日・電話番号の他) */
  customFields: CustomField[] = [{ title: "症状", required: false }];
  bookings: MockBooking[] = [];
  /** POST /mock/api/book の回数 (応答の種類に関わらず数える) */
  bookPostCount = 0;
  /** GET /bookings/new (リダイレクトされたものを含む) の回数 */
  newBookingAccessCount = 0;

  private server: Server;
  private port = 0;
  private hung = new Set<ServerResponse>();

  private constructor() {
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((e: Error) => json(res, 500, { message: e.message }));
    });
  }

  static async start(): Promise<MockSite> {
    const site = new MockSite();
    await new Promise<void>((resolve) => site.server.listen(0, "127.0.0.1", resolve));
    site.port = (site.server.address() as AddressInfo).port;
    return site;
  }

  /** ITICKET_BASE_URL に渡す値 */
  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}/park2`;
  }

  get isOpen(): boolean {
    return this.open || (this.openAt !== undefined && Date.now() >= this.openAt);
  }

  reset(): void {
    this.open = true;
    this.openAt = undefined;
    this.frames = defaultFrames();
    this.bookResponse = "ok";
    this.customFields = [{ title: "症状", required: false }];
    this.bookings = [];
    this.bookPostCount = 0;
    this.newBookingAccessCount = 0;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** 入力画面の項目定義 (name 属性は ${n}_${fieldId}_${fieldNo}_${inputType}_${req}) */
  private formDef() {
    return [
      { fieldId: 10, fieldNo: 1, inputType: 1, required: true, title: "氏名" },
      { fieldId: 11, fieldNo: 2, inputType: 5, required: true, title: "生年月日" },
      { fieldId: 15, fieldNo: 4, inputType: 1, required: true, title: "電話番号" },
      { fieldId: 16, fieldNo: 5, inputType: 1, required: true, title: "診察券番号" },
      ...this.customFields.map((c, i) => ({ fieldId: 20 + i, fieldNo: 0, inputType: 4, required: c.required, title: c.title })),
    ];
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://mock");
    const path = url.pathname;

    if (req.method === "GET" && path === "/mock/client.js") {
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      res.end(CLIENT_JS);
      return;
    }
    if (req.method === "GET" && path === "/mock/api/frames") {
      json(res, 200, { date: localDate8(), frames: this.isOpen ? this.frames : [], form: this.formDef() });
      return;
    }
    if (req.method === "POST" && path === "/mock/api/book") {
      await this.handleBook(req, res);
      return;
    }

    const m = /^(\/park2\/clinics\/\d+\/businesses\/\d+)(\/bookings\/.*)?$/.exec(path.replace(/\/$/, ""));
    if (req.method !== "GET" || !m) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    const top = m[1]!;
    const sub = m[2];
    if (sub === undefined) {
      this.html(res, topPage(top, this.isOpen));
      return;
    }
    if (sub === "/bookings/new") {
      this.newBookingAccessCount++;
      if (this.isOpen) this.html(res, shell());
      else this.redirect(res, top);
      return;
    }
    // 入力・確認・完了画面は SPA 内の遷移でのみ到達できる (直接開くと TOP に戻す)
    this.redirect(res, top);
  }

  private async handleBook(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.bookPostCount++;
    const body = JSON.parse(await readBody(req)) as { date: string; frameId: string; count: number; fields: Record<string, string> };
    if (this.bookResponse === "hang") {
      this.hung.add(res);
      res.on("close", () => this.hung.delete(res));
      return;
    }
    if (this.bookResponse === "errorModal") {
      json(res, 500, { message: this.errorMessage });
      return;
    }
    const frame = this.frames.find((f) => f.id === body.frameId);
    const patients: MockBookedPatient[] = [];
    for (let n = 1; n <= body.count; n++) {
      const p: MockBookedPatient = { name: "", cardNo: "", birth: "", phone: "", custom: {} };
      const birth: Record<string, string> = {};
      for (const [key, value] of Object.entries(body.fields)) {
        const k = /^(\d+)_(\d+)_(\d+)_(\d+)_(\d)(?:_(year|month|date))?$/.exec(key);
        if (!k || Number(k[1]) !== n) continue;
        const [fieldId, fieldNo] = [Number(k[2]), Number(k[3])];
        if (fieldNo === 1) p.name = value;
        else if (fieldNo === 2 && k[6]) birth[k[6]] = value.padStart(k[6] === "year" ? 4 : 2, "0");
        else if (fieldNo === 4) p.phone = value;
        else if (fieldNo === 5) p.cardNo = value;
        else if (fieldNo === 0) p.custom[this.customFields[fieldId - 20]?.title ?? String(fieldId)] = value;
      }
      p.birth = `${birth.year}-${birth.month}-${birth.date}`;
      patients.push(p);
    }
    const acceptNo = String(100 + this.bookings.length);
    this.bookings.push({ date: body.date, frameId: body.frameId, frameName: frame?.name ?? "", acceptNo, patients });
    json(res, 200, { acceptNo });
  }

  private html(res: ServerResponse, body: string) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(body);
  }

  private redirect(res: ServerResponse, location: string) {
    res.writeHead(307, { Location: location });
    res.end();
  }
}

const STYLE = `<style>.is-hidden{display:none}</style>`;

function topPage(top: string, open: boolean): string {
  const status = open
    ? `<div class="ipk-view-situation-body"><ul class="panel"><li>現在 3人 待ち</li></ul></div>`
    : `<div class="ipk-view-situation-body"><ul class="panel"><li><section class="ipk-non-service"><p>診察時間外</p></section></li></ul></div>`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>モック医院</title>${STYLE}</head><body>
<div class="ipk-l-main-contents"><div class="business-top-j">
<section class="ipk-page-title"><h1 class="ipk-page-title-main">モック医院</h1><h2 class="ipk-page-title-sub">診察</h2></section>
<section class="ipk-view-situation-j">${status}</section>
<section class="ipk-gmtp-to-book"><a href="${top}/bookings/new">予約へ</a></section>
</div></div></body></html>`;
}

/** /bookings/new の SPA シェル。以降の画面遷移は client.js が pushState で行う */
function shell(): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>モック予約</title>${STYLE}</head><body>
<div class="ipk-l-main-contents" id="app"></div>
<section class="ipk-exception-error" style="display:none"><div class="ipk-exception-error-body"></div><div class="modal-btn-area"><button type="button">閉じる</button></div></section>
<script src="/mock/client.js"></script>
</body></html>`;
}
