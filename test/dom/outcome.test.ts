import type { Browser, BrowserContext, Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeErrorModal, readErrorModal } from "../../src/pages/modal.js";
import { waitOutcome } from "../../src/pages/outcome.js";
import { launch, newPage, serveHtml } from "./helpers.js";

let browser: Browser;
let context: BrowserContext;
let page: Page;

beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser.close();
});
beforeEach(async () => {
  ({ context, page } = await newPage(browser));
});
afterEach(async () => {
  await context.close();
});

const CONFIRM = /\/bookings\/new_confirm$/;
const BASE_HTML = `
<section class="ipk-exception-error" style="display:none">
  <div class="ipk-exception-error-body">時間が経っているので
    トップページからやり直してください。</div>
  <div class="modal-btn-area"><button id="close">閉じる</button></div>
</section>
<div id="errs" style="display:none">入力エラー</div>
<script>
  window.showModal = () => (document.querySelector("section.ipk-exception-error").style.display = "block");
  window.goConfirm = () => history.pushState(null, "", "/park2/clinics/1/businesses/01/bookings/new_confirm");
  document.getElementById("close").addEventListener("click", () => (document.querySelector("section.ipk-exception-error").style.display = "none"));
</script>`;
const run = (js: string) => page.evaluate(js);

describe("waitOutcome", () => {
  beforeEach(async () => {
    await serveHtml(page, BASE_HTML, "/park2/clinics/1/businesses/01/bookings/new/20261026/frames/1/input");
  });

  it("すでに目的の URL なら url", async () => {
    await run("goConfirm()");
    expect(await waitOutcome(page, CONFIRM, 1000)).toEqual({ kind: "url" });
  });

  it("後から URL が変われば url (ポーリング)", async () => {
    await run("setTimeout(goConfirm, 300)");
    expect(await waitOutcome(page, CONFIRM, 3000)).toEqual({ kind: "url" });
  });

  it("section.ipk-exception-error が見えたら modal と本文 (空白は整形)", async () => {
    await run("setTimeout(showModal, 300)");
    expect(await waitOutcome(page, CONFIRM, 3000)).toEqual({
      kind: "modal",
      text: "時間が経っているので トップページからやり直してください。",
    });
  });

  it("非表示のモーダルは検出しない", async () => {
    expect(await waitOutcome(page, CONFIRM, 500)).toEqual({ kind: "timeout" });
  });

  it("URL とモーダルが同時なら url を優先", async () => {
    await run("showModal(); goConfirm();");
    expect(await waitOutcome(page, CONFIRM, 1000)).toEqual({ kind: "url" });
  });

  it("モーダルと extra が同時ならモーダルを優先", async () => {
    await run("showModal(); document.getElementById('errs').style.display = 'block';");
    expect((await waitOutcome(page, CONFIRM, 1000, { errors: "#errs" })).kind).toBe("modal");
  });

  it("extra のセレクタが見えたらその名前を返す", async () => {
    await run("setTimeout(() => (document.getElementById('errs').style.display = 'block'), 300)");
    expect(await waitOutcome(page, CONFIRM, 3000, { terms: "#nothing", errors: "#errs" })).toEqual({
      kind: "extra",
      name: "errors",
    });
  });

  it("何も起きなければ timeout", async () => {
    const t0 = Date.now();
    expect(await waitOutcome(page, CONFIRM, 400, { errors: "#errs" })).toEqual({ kind: "timeout" });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(400);
  });
});

describe("readErrorModal / closeErrorModal", () => {
  beforeEach(async () => {
    await serveHtml(page, BASE_HTML);
  });

  it("非表示なら undefined", async () => {
    expect(await readErrorModal(page)).toBeUndefined();
  });

  it("表示中は本文、閉じれば undefined", async () => {
    await run("showModal()");
    expect(await readErrorModal(page)).toBe("時間が経っているので トップページからやり直してください。");
    await closeErrorModal(page);
    expect(await readErrorModal(page)).toBeUndefined();
  });

  it("本文が空なら (本文なし)", async () => {
    await run("showModal(); document.querySelector('.ipk-exception-error-body').textContent = ''");
    expect(await readErrorModal(page)).toBe("(本文なし)");
  });
});
