import type { Locator, Page } from "playwright";
import type { ResolvedPatient } from "../config/load.js";
import { parseFieldName, type FieldKey } from "../fill/field-key.js";
import { planField, type FillAction } from "../fill/field-mapper.js";
import { AppError, MissingValueError, NotOpenError, ValidationError } from "../flow/errors.js";
import { INPUT } from "../site/selectors.js";
import { PATH } from "../site/urls.js";
import { modalError } from "./modal.js";
import { waitOutcome } from "./outcome.js";

export interface PlannedField {
  key: FieldKey;
  title: string;
  patient: ResolvedPatient;
  action: FillAction;
}

interface RawField {
  name: string;
  title: string;
}

/** フォーム内の入力欄 (name がパターンに合うもの) と項目タイトルを集める */
async function collectFields(page: Page): Promise<RawField[]> {
  const raw = await page.locator(INPUT.fields).evaluateAll((els) =>
    els.map((el) => {
      const item = el.closest(".ipk-one-item");
      const head = item?.querySelector("label, .ipk-input-patient-item");
      let title = "";
      if (head) {
        const clone = head.cloneNode(true) as HTMLElement;
        clone.querySelectorAll(".ipk-must-txt, .member-item-mark").forEach((n) => n.remove());
        title = (clone.textContent ?? "").replace(/\s+/g, "");
      }
      return { name: el.getAttribute("name") ?? "", title };
    }),
  );
  const seen = new Set<string>();
  return raw.filter((f) => f.name && !seen.has(f.name) && (seen.add(f.name), true));
}

/** 入力欄と患者の対応付け + 値の決定 (DOM を触らない部分) */
export function planFields(raw: RawField[], patients: ResolvedPatient[]): PlannedField[] {
  const parsed = raw.flatMap((r) => {
    const key = parseFieldName(r.name);
    return key ? [{ key, title: r.title }] : [];
  });
  if (parsed.length === 0) {
    throw new AppError(
      "入力欄が見つかりません (画面の構成が変わった可能性があります。artifacts の HTML を確認してください)",
    );
  }
  // 患者番号は 1 始まりだが、念のため出現順で対応付ける
  const indices = [...new Set(parsed.map((p) => p.key.patientIndex))].sort((a, b) => a - b);
  if (indices.length !== patients.length) {
    throw new AppError(`入力欄の人数 (${indices.length}) と指定した患者数 (${patients.length}) が一致しません`);
  }
  return parsed.map(({ key, title }) => {
    const patient = patients[indices.indexOf(key.patientIndex)]!;
    const label = patients.length > 1 ? `${patient.key}: ` : "";
    return { key, title, patient, action: planField(key, title, patient, label) };
  });
}

/** 数字は前後が数字でない位置でのみ一致させる (「2」が「12日」に当たらないように) */
function labelContains(label: string, value: string): boolean {
  if (!/^\d+$/.test(value)) return label.includes(value);
  return new RegExp(`(^|\\D)0*${Number(value)}(\\D|$)`).test(label);
}

async function applyRadio(page: Page, f: PlannedField, action: Extract<FillAction, { kind: "radio" }>): Promise<void> {
  const radios = page.locator(`input[type="radio"][name="${f.key.name}"]`);
  const n = await radios.count();
  let target: Locator | undefined;
  for (let i = 0; i < n && !target; i++) {
    const r = radios.nth(i);
    const id = await r.getAttribute("id");
    const label = id
      ? ((await page
          .locator(`label[for="${id}"]`)
          .first()
          .textContent()
          .catch(() => "")) ?? "")
      : "";
    if (action.match?.test(label)) target = r;
  }
  if (!target && action.value !== undefined) {
    for (let i = 0; i < n && !target; i++) {
      if ((await radios.nth(i).getAttribute("value")) === action.value) target = radios.nth(i);
    }
  }
  if (!target) {
    if (f.key.required) throw new MissingValueError(`「${f.title}」の選択肢が見つかりません`);
    return;
  }
  await target.check({ force: true });
}

async function applyField(page: Page, f: PlannedField): Promise<void> {
  const el = page.locator(`[name="${f.key.name}"]`).first();
  const a = f.action;
  switch (a.kind) {
    case "skip":
      return;
    case "fill":
      await el.fill(a.value);
      // 電話番号欄などは表示整形されうるので、数字だけの値は数字同士で比べる
      const got = await el.inputValue();
      const same = /^\d+$/.test(a.value) ? got.replace(/\D/g, "") === a.value : got === a.value;
      if (!same) throw new ValidationError(`「${f.title}」に値を入力できませんでした`);
      return;
    case "select": {
      const tag = await el.evaluate((e) => e.tagName.toLowerCase());
      if (tag !== "select") {
        await el.fill(a.value);
        return;
      }
      // value 一致で選び、なければラベル一致 (例: 年の「1990（平成2）年」)
      const options = await el.evaluate((s) =>
        [...(s as HTMLSelectElement).options].map((o) => ({ value: o.value, label: o.text.trim() })),
      );
      const hit =
        options.find((o) => o.value === a.value) ??
        options.find((o) => o.label === a.value) ??
        options.find((o) => o.value !== "" && labelContains(o.label, a.value));
      if (!hit) throw new ValidationError(`「${f.title}」に選択肢 ${a.value} がありません`);
      await el.selectOption({ value: hit.value });
      return;
    }
    case "radio":
      await applyRadio(page, f, a);
      return;
    case "checkbox":
      for (const v of a.values) {
        await page.locator(`input[type="checkbox"][name="${f.key.name}"][value="${v}"]`).check({ force: true });
      }
      return;
  }
}

export interface InputResult {
  fields: PlannedField[];
}

/** 入力画面を埋めて確認画面へ進む */
export async function fillInputAndProceed(
  page: Page,
  patients: ResolvedPatient[],
  opts: { cancelCode?: string; timeoutMs?: number; log?: (m: string) => void } = {},
): Promise<InputResult> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  await page.locator(INPUT.form).first().waitFor({ state: "visible", timeout: timeoutMs });
  await page.locator(INPUT.fields).first().waitFor({ state: "attached", timeout: timeoutMs });

  const fields = planFields(await collectFields(page), patients);
  for (const f of fields) {
    opts.log?.(
      `  入力: ${f.patient.key} 「${f.title}」 ${f.action.kind === "skip" ? `(skip: ${f.action.reason})` : f.action.kind}`,
    );
    await applyField(page, f);
  }

  const cancel = page.locator(INPUT.cancelCode);
  if ((await cancel.count()) > 0) {
    if (!opts.cancelCode)
      throw new MissingValueError(
        "この枠はキャンセルコード (4 桁) が必要です。clinics.<key>.cancel_code を設定してください",
      );
    await cancel.fill(opts.cancelCode);
  }

  const consent = page.locator(INPUT.consentCheckbox);
  if ((await consent.count()) > 0 && !(await consent.isChecked())) {
    await consent.check({ force: true }).catch(() => page.locator(INPUT.consentLabel).click());
  }

  await page.locator(INPUT.submit).first().click();
  for (let i = 0; i < 2; i++) {
    const o = await waitOutcome(page, PATH.confirm, timeoutMs, {
      errors: INPUT.validationErrors,
      terms: INPUT.termsModal,
    });
    if (o.kind === "url") return { fields };
    if (o.kind === "modal") throw modalError(o.text);
    if (o.kind === "extra" && o.name === "errors") {
      const msgs = await page.locator(INPUT.validationErrors).allInnerTexts();
      throw new ValidationError(`入力エラー: ${msgs.map((m) => m.trim()).join(" / ")}`);
    }
    if (o.kind === "extra" && o.name === "terms") {
      // 同意チェックが効かなかった場合の「利用規約に同意しますか」モーダル
      await page.locator(INPUT.termsModalYes).first().click();
      continue;
    }
    break;
  }
  throw new NotOpenError("確認画面に進めませんでした (タイムアウト)");
}
