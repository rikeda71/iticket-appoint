// モックサイトのクライアント JS (ブラウザで実行される)。
// 実サイト (Next.js SPA) 同様、history.pushState で 枠一覧 → 入力 → 確認 → 完了 を切り替える。
// DOM は src/site/selectors.ts のセレクタ・入力欄 name 規則に合わせた合成物 (個人情報なし)。
(() => {
  "use strict";
  const topPath = location.pathname.replace(/\/bookings\/.*$/, "");
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

  // ---- 枠一覧 ----
  function renderFramesScreen() {
    const opts = [1, 2, 3, 4, 5]
      .map((n) => `<option value="${n}"${n === st.count ? " selected" : ""}>${n}人</option>`)
      .join("");
    app.innerHTML = `
      <section class="ipk-date-select"><input type="radio" id="today" checked><label for="today">本日</label></section>
      <section class="ipk-select-book-num"><select>${opts}</select></section>
      <section class="ipk-non-time-frame is-hidden"><p>現在、予約可能な時間ではありません。</p></section>
      <section class="ipk-time-list-j"></section>`;
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
        return `<div data-id="${esc(f.id)}">
          <span class="timezone">${esc(f.name)}<br>${esc(f.range)}</span>
          <span class="ipk-time-list-wait">${esc(f.wait)}</span>
          ${oop ? '<div class="ipk-bookable-time is-out-of-period">予約可能時間外</div>' : `<p class="ipk-time-list-message${ok ? " is-hidden" : ""}">満員のため受付を終了しました</p>`}
          <button type="button" class="ipk-primary-btn${ok ? "" : " is-hidden"}">次へ</button>
        </div>`;
      })
      .join("");
    list.querySelectorAll("button.ipk-primary-btn").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.parentElement.dataset.id;
        st.frame = data.frames.find((f) => f.id === id);
        history.pushState(null, "", `${newPath}/${st.date}/frames/${id}/input`);
        renderInput();
      });
    });
  }

  // ---- 入力 ----
  const nameOf = (n, f, part) =>
    `${n}_${f.fieldId}_${f.fieldNo}_${f.inputType}_${f.required ? 1 : 0}${part ? `_${part}` : ""}`;
  const must = (f) => (f.required ? '<span class="ipk-must-txt">必須</span>' : "");

  function fieldHtml(n, f) {
    if (f.inputType === 5) {
      const year = new Date().getFullYear();
      const sel = (part, items) =>
        `<select name="${nameOf(n, f, part)}"><option value="">--</option>${items.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>`;
      const years = Array.from({ length: 100 }, (_, i) => [year - i, `${year - i}年`]);
      const months = Array.from({ length: 12 }, (_, i) => [i + 1, `${i + 1}月`]);
      const dates = Array.from({ length: 31 }, (_, i) => [i + 1, `${i + 1}日`]);
      return `<div class="ipk-one-item"><label>${esc(f.title)}${must(f)}</label>${sel("year", years)}${sel("month", months)}${sel("date", dates)}</div>`;
    }
    const control =
      f.inputType === 4 ? `<textarea name="${nameOf(n, f)}"></textarea>` : `<input type="text" name="${nameOf(n, f)}">`;
    return `<div class="ipk-one-item"><label>${esc(f.title)}${must(f)}</label>${control}</div>`;
  }

  function renderInput() {
    const blocks = Array.from(
      { length: st.count },
      (_, i) => `<h3>${i + 1}人目</h3>${st.form.map((f) => fieldHtml(i + 1, f)).join("")}`,
    ).join("");
    app.innerHTML = `
      <section class="ipk-input-patient">
        <div class="ipk-input-patient-error is-hidden"></div>
        <form onsubmit="return false">
          ${blocks}
          <div><input type="checkbox" id="consent-checkbox"><label for="consent-checkbox">利用規約に同意する</label></div>
          <div class="btn-area"><button type="button" class="ipk-primary-btn">次へ</button></div>
        </form>
      </section>
      <section class="ipk-privacy-policy-modal is-hidden"><p>利用規約に同意しますか</p><button type="button" class="ipk-primary-btn">はい</button></section>`;
    $("section.ipk-input-patient div.btn-area button").addEventListener("click", onNext);
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
      return `${g("year")}年${g("month")}月${g("date")}日`;
    }
    return st.values[nameOf(n, f)] ?? "";
  }

  function renderConfirm() {
    const blocks = Array.from({ length: st.count }, (_, i) => {
      const n = i + 1;
      const items = st.form
        .map(
          (f) =>
            `<div class="ipk-confirm-patient-item"><span>${esc(f.title)}</span><span class="ipk-confirm-patient-data">${esc(display(n, f))}</span></div>`,
        )
        .join("");
      return `<div id="ipk-input-patient-confirm-form-${n}">${items}</div>`;
    }).join("");
    app.innerHTML = `
      <section class="ipk-guide"><p>予約はまだ完了していません。内容を確認して「予約する」を押してください。</p></section>
      <section class="ipk-confirm-patient">${blocks}</section>
      <div class="btn-area"><button type="button" class="ipk-primary-btn">予約する</button></div>`;
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

  renderFramesScreen();
})();
