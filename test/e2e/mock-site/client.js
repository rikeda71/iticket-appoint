// モックサイトのクライアント JS (ブラウザで実行される)。
// 実サイト (Next.js SPA) 同様、TOP の「予約へ」から history.pushState で 枠一覧 → 入力 → 確認 → 完了 を切り替える。
// hydration (data-hydration-ms) 前の「予約へ」は通常のリンクとして /bookings/new を直接開き、サーバーに TOP へ戻される。
// DOM は 2026-10 に実サイトで保存した HTML の構造に合わせた合成物 (個人情報なし)。
(() => {
  "use strict";
  const script = document.currentScript;
  const topPath = location.pathname.replace(/\/bookings\/.*$/, "").replace(/\/$/, "");
  const newPath = `${topPath}/bookings/new`;
  const app = document.getElementById("app");
  const st = { count: 1, date: "", frame: null, form: [], values: {} };

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const $ = (sel) => document.querySelector(sel);

  function showModal(msg) {
    const m = $("section.ipk-exception-error");
    m.querySelector(".ipk-exception-error-body").textContent = msg;
    m.style.display = "block";
  }
  $("section.ipk-exception-error .modal-btn-area button").addEventListener("click", () => {
    $("section.ipk-exception-error").style.display = "none";
  });

  // ---- TOP ----
  function hydrateTop() {
    const link = $("section.ipk-gmtp-to-book a");
    if (!link) return;
    link.addEventListener("click", async (e) => {
      e.preventDefault();
      // 実サイトでは RSC の取得。受付時間外は TOP に留まる
      const res = await fetch("/mock/api/enter", { method: "POST" });
      const data = await res.json();
      if (!data.open) return;
      history.pushState(null, "", newPath);
      renderFramesScreen();
    });
  }

  // ---- 共通 ----
  const WEEK = "日月火水木金土";
  function dateLabel(d8) {
    const [y, m, d] = [Number(d8.slice(0, 4)), Number(d8.slice(4, 6)), Number(d8.slice(6, 8))];
    return `${y}年${m}月${d}日（${WEEK[new Date(y, m - 1, d).getDay()]}）`;
  }
  const period = (f) => f.range.replace(/[()]/g, "");
  const timezone = (f) => `<span class="timezone">${esc(f.name)}<span class="timeframe">${esc(f.range)}</span></span>`;

  function requestDateHtml() {
    const f = st.frame;
    return `<section class="ipk-request-date"><h1 class="ipk-request-date-title-j">受診希望日時</h1><ul>
      <li>${esc(dateLabel(st.date))}</li><li>${timezone(f)}</li>
      <li class="ipk-bookable-time ">予約可能時間 /<span class="period">${esc(period(f))}</span></li></ul></section>`;
  }

  // ---- 枠一覧 ----
  function renderFramesScreen() {
    const opts = [1, 2, 3, 4, 5]
      .map((n) => `<option value="${n}"${n === st.count ? " selected" : ""}>${n}</option>`)
      .join("");
    app.innerHTML = `
      <section class="ipk-date-select"><h1 class="ipk-date-select-title-j">受診希望日時</h1><form class="pure-form">
        <div class=""><section class="ipk-select-book-num"><h2>予約人数</h2><div class="ipk-select-book-num-body"><select>${opts}</select><span>人</span></div></section></div>
        <div><section class="ipk-non-time-frame is-hidden"><p>現在、予約可能な時間ではありません。</p></section><section class="ipk-time-list-j"></section></div>
      </form></section>
      <section class="ipk-back-btn-l"><div class="btn-area"><a class="pure-button" href="${esc(topPath)}">戻る</a></div></section>`;
    $("section.ipk-select-book-num select").addEventListener("change", (e) => {
      st.count = Number(e.target.value);
      loadFrames();
    });
    loadFrames();
  }

  async function loadFrames() {
    const list = $("section.ipk-time-list-j");
    list.innerHTML = "";
    $("section.ipk-non-time-frame").classList.add("is-hidden");
    const res = await fetch(`/mock/api/frames?count=${st.count}`);
    const data = await res.json();
    st.date = data.date;
    st.form = data.form;
    if (data.frames.length === 0) {
      $("section.ipk-non-time-frame").classList.remove("is-hidden");
      return;
    }
    list.innerHTML = data.frames
      .map((f) => {
        const ok = f.status === "ok";
        const oop = f.status === "out-of-period";
        const mark = ok ? "○" : "×";
        return `<div data-id="${esc(f.id)}">
          <h1>${timezone(f)}</h1>
          <div class="ipk-bookable-time ${oop ? "is-out-of-period" : ""}">予約可能時間 /<span class="period">${esc(period(f))}</span></div>
          <ul><li>
            <div class="ipk-time-list-one-item">
              <div class="ipk-wrap-status"><div class="ipk-time-list-status">${mark}</div><div class="ipk-time-list-timeframe"><span class="ipk-time-list-wait">${esc(f.wait)}</span></div></div>
              <div class="ipk-wrap-button"><button type="button" class="ipk-primary-btn pure-button ${ok ? "" : "is-hidden"}">次へ</button></div>
            </div>
            <p class="ipk-time-list-message${ok || oop ? " is-hidden" : ""}">空き枠がないため、予約できません。</p>
          </li></ul>
        </div>`;
      })
      .join("");
    list.querySelectorAll("button.ipk-primary-btn").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.closest("[data-id]").dataset.id;
        st.frame = data.frames.find((f) => f.id === id);
        st.values = {};
        history.pushState(null, "", `${newPath}/${st.date}/frames/${id}/input`);
        renderInput();
      });
    });
  }

  // ---- 入力 ----
  const nameOf = (n, f, part) =>
    `${n}_${f.fieldId}_${f.fieldNo}_${f.inputType}_${f.required ? 1 : 0}${part ? `_${part}` : ""}`;
  const must = (f) => (f.required ? '<span class="ipk-must-txt ">（必須）</span>' : "");
  const note = (f) => `<div class="ipk-input-patient-note">${esc(f.title)}を記入</div>`;

  function era(y) {
    if (y >= 2019) return `令和${y === 2019 ? "元" : y - 2018}`;
    if (y >= 1989) return `平成${y === 1989 ? "元" : y - 1988}`;
    return `昭和${y - 1925}`;
  }

  function fieldHtml(n, f) {
    if (f.inputType === 5) {
      const year = new Date().getFullYear();
      const sel = (part, cls, empty, items) =>
        `<select class="${cls}" name="${nameOf(n, f, part)}"><option value="">${empty}</option>${items.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>`;
      const years = Array.from({ length: 100 }, (_, i) => [year - i, `${year - i}（${era(year - i)}）年`]);
      const months = Array.from({ length: 12 }, (_, i) => [i + 1, `${i + 1}月`]);
      const dates = Array.from({ length: 31 }, (_, i) => [i + 1, `${i + 1}日`]);
      return `<div class="one-item ipk-one-item"><label>${esc(f.title)}${must(f)}</label>
        <div class="pure-u-1-1">${sel("year", "pure-u-1-1", "--年", years)}</div>
        <div class="pure-u-1-2">${sel("month", "pure-u-11-12", "--月", months)}</div>
        <div class="pure-u-1-2">${sel("date", "pure-u-1-1", "--日", dates)}</div>${note(f)}</div>`;
    }
    const name = nameOf(n, f);
    const control =
      f.inputType === 4
        ? `<textarea placeholder="${esc(f.title)}" id="${name}" name="${name}"></textarea>`
        : `<input placeholder="${esc(f.title)}" id="${name}" type="${f.fieldNo === 4 ? "tel" : "text"}" name="${name}">`;
    return `<div class="ipk-one-item"><div class="pure-g"><div class="pure-u-1-1"><label for="${name}">${esc(f.title)}${must(f)}</label>${control}</div></div>${note(f)}</div>`;
  }

  function renderInput() {
    const blocks = Array.from(
      { length: st.count },
      (_, i) =>
        `<div id="ipk-input-patient-input-form-${i + 1}"><h2>${i + 1}人目</h2>${st.form.map((f) => fieldHtml(i + 1, f)).join("")}</div>`,
    ).join("");
    app.innerHTML = `
      ${requestDateHtml()}
      <section class="ipk-guide"><p class="ipk-guide-message-center">受診される方の情報を入力してください。</p></section>
      <section class="ipk-input-patient"><h1 class="ipk-input-patient-title">受診者情報入力</h1>
        <form class="pure-form pure-form-stacked">
          <div class="ipk-input-patient-error is-hidden"></div>
          ${blocks}
          <section class="ipk-consent"><div class="consent-body">
            <div class="checkbox-wrapper"><input id="consent-checkbox" type="checkbox"><label for="consent-checkbox" class="pure-checkbox"></label></div>
            <p><a href="#">「利用規約」</a>および<a href="#">「プライバシーポリシー」</a>に同意する</p>
          </div></section>
          <div class="btn-area"><button type="submit" class="pure-button">戻る</button><button type="submit" class="ipk-primary-btn pure-button">次へ</button></div>
        </form>
      </section>
      <section class="ipk-privacy-policy-modal is-hidden"><p>利用規約に同意しますか</p><button type="button" class="ipk-primary-btn">はい</button></section>`;
    for (const [k, v] of Object.entries(st.values)) {
      const el = document.querySelector(`section.ipk-input-patient form [name="${k}"]`);
      if (el) el.value = v;
    }
    $("section.ipk-input-patient form").addEventListener("submit", (e) => {
      e.preventDefault();
      if (e.submitter && !e.submitter.classList.contains("ipk-primary-btn")) {
        history.pushState(null, "", newPath);
        renderFramesScreen();
        return;
      }
      onNext();
    });
    $("section.ipk-privacy-policy-modal button").addEventListener("click", goConfirm);
  }

  function collect() {
    const out = {};
    for (const el of document.querySelectorAll("section.ipk-input-patient form [name]")) out[el.name] = el.value.trim();
    return out;
  }

  /** 必須チェック (未入力ならエラー表示) */
  function validate(values) {
    const msgs = [];
    for (let n = 1; n <= st.count; n++) {
      for (const f of st.form) {
        if (!f.required) continue;
        const names = f.inputType === 5 ? ["year", "month", "date"].map((p) => nameOf(n, f, p)) : [nameOf(n, f)];
        if (names.some((k) => !values[k])) msgs.push(`${st.count > 1 ? `${n}人目の` : ""}${f.title}を入力してください`);
      }
    }
    return msgs;
  }

  function onNext() {
    const values = collect();
    const err = $("div.ipk-input-patient-error");
    const msgs = validate(values);
    if (msgs.length > 0) {
      err.innerHTML = msgs.map((m) => `<p>${esc(m)}</p>`).join("");
      err.classList.remove("is-hidden");
      return;
    }
    err.classList.add("is-hidden");
    st.values = values;
    if (!$("#consent-checkbox").checked) {
      $("section.ipk-privacy-policy-modal").classList.remove("is-hidden");
      return;
    }
    goConfirm();
  }

  // ---- 確認 ----
  function goConfirm() {
    history.pushState(null, "", `${topPath}/bookings/new_confirm`);
    renderConfirm();
  }

  function display(n, f) {
    if (f.inputType === 5) {
      const g = (p) => st.values[nameOf(n, f, p)];
      return `${g("year")}（${era(Number(g("year")))}）年${g("month")}月${g("date")}日`;
    }
    return st.values[nameOf(n, f)] ?? "";
  }

  function renderConfirm() {
    const blocks = Array.from({ length: st.count }, (_, i) => {
      const n = i + 1;
      const items = st.form
        .map(
          (f) =>
            `<li><div class="ipk-confirm-patient-item">${esc(f.title)}${f.required ? '<span class="ipk-must-txt">（必須）</span>' : ""}</div><div class="ipk-confirm-patient-data">${esc(display(n, f))}</div><div class="ipk-confirm-patient-note">${esc(f.title)}を記入</div></li>`,
        )
        .join("");
      return `<div id="ipk-input-patient-confirm-form-${n}"><h2>${n}人目</h2><ul>${items}</ul></div>`;
    }).join("");
    app.innerHTML = `
      <section class="ipk-guide"><p class="ipk-guide-message-center"><em>予約はまだ完了していません。</em></p></section>
      ${requestDateHtml()}
      <section class="ipk-confirm-patient"><h1 class="ipk-confirm-patient-title">受診者</h1>
        <div>${blocks}<ul class="is-hidden"><section class="ipk-confirm-cancel-code"><div class="cancel-code-title">【 キャンセルコード 】</div><div class="cancel-code-body"></div></section></ul></div>
        <div class="btn-area"><button type="button" class="pure-button">戻る</button><button type="button" class="ipk-primary-btn pure-button">予約する</button></div>
      </section>`;
    $("section.ipk-confirm-patient div.btn-area button.pure-button:not(.ipk-primary-btn)").addEventListener(
      "click",
      () => {
        history.pushState(null, "", `${newPath}/${st.date}/frames/${st.frame.id}/input`);
        renderInput();
      },
    );
    $("div.btn-area button.ipk-primary-btn").addEventListener("click", onBook);
  }

  async function onBook() {
    try {
      const res = await fetch("/mock/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: st.date, frameId: st.frame.id, count: st.count, fields: st.values }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showModal(data.message || "エラーが発生しました。");
        return;
      }
      history.pushState(null, "", `${topPath}/bookings/new_complete`);
      app.innerHTML = `<section class="ipk-complete"><p>予約が完了しました。</p><p>受付番号：${esc(data.acceptNo)}</p></section>`;
    } catch {
      showModal("通信エラーが発生しました。");
    }
  }

  const delay = Number(script?.dataset.hydrationMs ?? 0);
  if (delay > 0) setTimeout(hydrateTop, delay);
  else hydrateTop();
})();
