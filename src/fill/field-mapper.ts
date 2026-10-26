import type { Patient } from "../config/schema.js";
import { MissingValueError } from "../flow/errors.js";
import { FieldNo, InputType, type FieldKey } from "./field-key.js";

/** 1 項目に対して行う操作 */
export type FillAction =
  | { kind: "fill"; value: string }
  | { kind: "select"; value: string }
  /** label の文言が match に一致する選択肢を選ぶ。なければ value 一致 */
  | { kind: "radio"; match?: RegExp; value?: string }
  | { kind: "checkbox"; values: string[] }
  | { kind: "skip"; reason: string };

/** 新患の場合に診察券番号欄へ入れる文言 */
export const NEW_PATIENT_CARD_TEXT = "新患";

export function birthParts(birth: string): { year: string; month: string; date: string } {
  const [y, m, d] = birth.split("-").map(Number) as [number, number, number];
  // サイトの select の value はゼロ埋めなし
  return { year: String(y), month: String(m), date: String(d) };
}

export function phoneDigits(phone: string): string {
  return phone.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\D/g, "");
}

/** 医院独自項目: タイトルと設定キーの部分一致 (双方向) */
export function findCustomValue(title: string, custom: Record<string, string>): string | undefined {
  const t = title.replace(/\s+/g, "");
  for (const [k, v] of Object.entries(custom)) {
    const kk = k.replace(/\s+/g, "");
    if (kk.length > 0 && t.length > 0 && (t.includes(kk) || kk.includes(t))) return v;
  }
  return undefined;
}

/** 値 (文字列) を input_type に応じた操作に変換する */
function byType(inputType: number, value: string): FillAction {
  switch (inputType) {
    case InputType.select:
      return { kind: "select", value };
    case InputType.radio:
      return { kind: "radio", value };
    case InputType.checkbox:
      return { kind: "checkbox", values: value.split(",").map((s) => s.trim()) };
    default:
      return { kind: "fill", value };
  }
}

/**
 * 項目 (name 属性をパースしたもの) と患者設定から操作を決める純粋関数。
 * 必須項目に入れる値がなければ MissingValueError。
 */
export function planField(key: FieldKey, title: string, patient: Patient, patientLabel = ""): FillAction {
  const missing = (what: string): FillAction => {
    if (key.required) {
      throw new MissingValueError(`${patientLabel}必須項目「${title}」に入れる値がありません (${what} を設定してください)`);
    }
    return { kind: "skip", reason: `${what} が未設定 (任意項目)` };
  };

  switch (key.fieldNo) {
    case FieldNo.name:
      return byType(key.inputType, patient.name);
    case FieldNo.birth: {
      const p = birthParts(patient.birth);
      if (key.part) return { kind: "select", value: p[key.part] };
      return byType(key.inputType, `${p.year}/${p.month}/${p.date}`);
    }
    case FieldNo.sex:
      if (!patient.sex) return missing("sex");
      return patient.sex === "male" ? { kind: "radio", match: /男/, value: "0" } : { kind: "radio", match: /女/, value: "1" };
    case FieldNo.contact:
      return byType(key.inputType, phoneDigits(patient.phone));
    case FieldNo.patientCardNo:
      if (patient.new_patient) return byType(key.inputType, NEW_PATIENT_CARD_TEXT);
      if (!patient.patient_card_no) return missing("patient_card_no");
      return byType(key.inputType, patient.patient_card_no);
    case FieldNo.newPatientFlg:
      if (key.inputType === InputType.text || key.inputType === InputType.textarea) {
        return { kind: "fill", value: patient.new_patient ? "新患" : "再診" };
      }
      return { kind: "radio", match: patient.new_patient ? /新患|初診|初めて|はじめて|はい/ : /再診|いいえ|2回目|二回目/ };
    case FieldNo.callTime: {
      const v = findCustomValue(title, patient.custom_fields);
      return v !== undefined ? byType(key.inputType, v) : missing(`custom_fields["${title}"]`);
    }
    case FieldNo.nameKana:
      if (!patient.name_kana) return missing("name_kana");
      return byType(key.inputType, patient.name_kana);
    default: {
      const v = findCustomValue(title, patient.custom_fields);
      if (v === undefined) return missing(`custom_fields["${title}"]`);
      return byType(key.inputType, v);
    }
  }
}
