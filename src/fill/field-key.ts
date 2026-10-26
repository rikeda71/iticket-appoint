/** サイトの定数 (InputField / InputType) */
export const FieldNo = {
  custom: 0,
  name: 1,
  birth: 2,
  sex: 3,
  contact: 4,
  patientCardNo: 5,
  newPatientFlg: 6,
  callTime: 7,
  nameKana: 8,
} as const;

export const InputType = {
  text: 1,
  radio: 2,
  checkbox: 3,
  textarea: 4,
  select: 5,
  date: 6,
} as const;

export type DatePart = "year" | "month" | "date";

export interface FieldKey {
  name: string;
  patientIndex: number;
  fieldId: number;
  fieldNo: number;
  inputType: number;
  required: boolean;
  part?: DatePart;
}

/** `${patientIndex}_${fieldId}_${fieldNo}_${inputType}_${requireFlg}[_year|_month|_date]` */
const FIELD_NAME_RE = /^(\d+)_(\d+)_(\d+)_(\d+)_(\d)(?:_(year|month|date))?$/;

export function parseFieldName(name: string): FieldKey | undefined {
  const m = FIELD_NAME_RE.exec(name);
  if (!m) return undefined;
  return {
    name,
    patientIndex: Number(m[1]),
    fieldId: Number(m[2]),
    fieldNo: Number(m[3]),
    inputType: Number(m[4]),
    required: m[5] === "1",
    ...(m[6] ? { part: m[6] as DatePart } : {}),
  };
}
