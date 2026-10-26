import { describe, expect, it } from "vitest";
import type { Patient } from "../../src/config/schema.js";
import {
  birthParts,
  findCustomValue,
  NEW_PATIENT_CARD_TEXT,
  phoneDigits,
  planField,
} from "../../src/fill/field-mapper.js";
import { FieldNo, InputType, type FieldKey } from "../../src/fill/field-key.js";
import { MissingValueError } from "../../src/flow/errors.js";

const patient = (over: Partial<Patient> = {}): Patient => ({
  name: "山田 太郎",
  name_kana: "ヤマダ タロウ",
  patient_card_no: "12345",
  birth: "1990-01-02",
  phone: "090-1234-5678",
  sex: "male",
  new_patient: false,
  custom_fields: {},
  ...over,
});

const key = (fieldNo: number, inputType: number, required = true, part?: FieldKey["part"]): FieldKey => ({
  name: `1_1_${fieldNo}_${inputType}_${required ? 1 : 0}`,
  patientIndex: 1,
  fieldId: 1,
  fieldNo,
  inputType,
  required,
  ...(part ? { part } : {}),
});

describe("birthParts", () => {
  it("ゼロ埋めなしの年・月・日に分ける", () => {
    expect(birthParts("1990-01-02")).toEqual({ year: "1990", month: "1", date: "2" });
    expect(birthParts("2005-12-31")).toEqual({ year: "2005", month: "12", date: "31" });
  });
});

describe("phoneDigits", () => {
  it("ハイフンや空白を除く", () => {
    expect(phoneDigits("090-1234-5678")).toBe("09012345678");
    expect(phoneDigits("(03) 1234 5678")).toBe("0312345678");
  });
  it("全角数字を半角にする", () => {
    expect(phoneDigits("０９０－１２３４－５６７８")).toBe("09012345678");
  });
});

describe("findCustomValue", () => {
  it("タイトルがキーを含めば一致", () => {
    expect(findCustomValue("症状をご記入ください", { 症状: "鼻水" })).toBe("鼻水");
  });
  it("キーがタイトルを含んでも一致 (双方向)", () => {
    expect(findCustomValue("症状", { 現在の症状について: "鼻水" })).toBe("鼻水");
  });
  it("空白は無視して比較する", () => {
    expect(findCustomValue("症 状", { "症　状": "鼻水" })).toBe("鼻水");
  });
  it("一致しなければ undefined", () => {
    expect(findCustomValue("住所", { 症状: "鼻水" })).toBeUndefined();
  });
  it("空のキーは何にも一致しない", () => {
    expect(findCustomValue("症状", { "": "x" })).toBeUndefined();
  });
  it("空のタイトルは何にも一致しない", () => {
    expect(findCustomValue("", { 症状: "鼻水" })).toBeUndefined();
  });
  it("複数キーのうち最初に一致したものを返す", () => {
    expect(findCustomValue("症状", { 住所: "a", 症状: "b" })).toBe("b");
  });
});

describe("planField", () => {
  describe("氏名 (fieldNo=1)", () => {
    it("text は fill", () => {
      expect(planField(key(FieldNo.name, InputType.text), "氏名", patient())).toEqual({
        kind: "fill",
        value: "山田 太郎",
      });
    });
    it("textarea は fill", () => {
      expect(planField(key(FieldNo.name, InputType.textarea), "氏名", patient())).toEqual({
        kind: "fill",
        value: "山田 太郎",
      });
    });
    it("select は select / radio は radio", () => {
      expect(planField(key(FieldNo.name, InputType.select), "氏名", patient())).toEqual({
        kind: "select",
        value: "山田 太郎",
      });
      expect(planField(key(FieldNo.name, InputType.radio), "氏名", patient())).toEqual({
        kind: "radio",
        value: "山田 太郎",
      });
    });
    it("checkbox はカンマ区切りで分割しトリムする", () => {
      expect(planField(key(FieldNo.name, InputType.checkbox), "氏名", patient({ name: "a, b" }))).toEqual({
        kind: "checkbox",
        values: ["a", "b"],
      });
    });
  });

  describe("生年月日 (fieldNo=2)", () => {
    it("part ごとに select の値を返す", () => {
      expect(planField(key(FieldNo.birth, InputType.select, true, "year"), "生年月日", patient())).toEqual({
        kind: "select",
        value: "1990",
      });
      expect(planField(key(FieldNo.birth, InputType.select, true, "month"), "生年月日", patient())).toEqual({
        kind: "select",
        value: "1",
      });
      expect(planField(key(FieldNo.birth, InputType.select, true, "date"), "生年月日", patient())).toEqual({
        kind: "select",
        value: "2",
      });
    });
    it("part がなければ YYYY/M/D 形式で入力", () => {
      expect(planField(key(FieldNo.birth, InputType.text), "生年月日", patient())).toEqual({
        kind: "fill",
        value: "1990/1/2",
      });
    });
    it("part がなく select の場合は select", () => {
      expect(planField(key(FieldNo.birth, InputType.select), "生年月日", patient())).toEqual({
        kind: "select",
        value: "1990/1/2",
      });
    });
  });

  describe("性別 (fieldNo=3)", () => {
    it("male は「男」ラベル / value=0", () => {
      const a = planField(key(FieldNo.sex, InputType.radio), "性別", patient({ sex: "male" }));
      expect(a).toMatchObject({ kind: "radio", value: "0" });
      expect(a.kind === "radio" && a.match?.test("男性")).toBe(true);
      expect(a.kind === "radio" && a.match?.test("女性")).toBe(false);
    });
    it("female は「女」ラベル / value=1", () => {
      const a = planField(key(FieldNo.sex, InputType.radio), "性別", patient({ sex: "female" }));
      expect(a).toMatchObject({ kind: "radio", value: "1" });
      expect(a.kind === "radio" && a.match?.test("女性")).toBe(true);
      expect(a.kind === "radio" && a.match?.test("男性")).toBe(false);
    });
    it("sex 未設定: 必須は MissingValueError", () => {
      expect(() => planField(key(FieldNo.sex, InputType.radio, true), "性別", patient({ sex: undefined }))).toThrow(
        MissingValueError,
      );
    });
    it("sex 未設定: 任意は skip", () => {
      expect(planField(key(FieldNo.sex, InputType.radio, false), "性別", patient({ sex: undefined }))).toMatchObject({
        kind: "skip",
      });
    });
  });

  describe("連絡先 (fieldNo=4)", () => {
    it("数字だけにして入力", () => {
      expect(planField(key(FieldNo.contact, InputType.text), "電話番号", patient())).toEqual({
        kind: "fill",
        value: "09012345678",
      });
    });
    it("全角でも半角数字になる", () => {
      expect(
        planField(key(FieldNo.contact, InputType.text), "電話番号", patient({ phone: "０９０１２３４５６７８" })),
      ).toEqual({
        kind: "fill",
        value: "09012345678",
      });
    });
  });

  describe("診察券番号 (fieldNo=5)", () => {
    it("再診は診察券番号", () => {
      expect(planField(key(FieldNo.patientCardNo, InputType.text), "診察券番号", patient())).toEqual({
        kind: "fill",
        value: "12345",
      });
    });
    it("新患は「新患」を入れる (番号があっても)", () => {
      expect(NEW_PATIENT_CARD_TEXT).toBe("新患");
      expect(
        planField(key(FieldNo.patientCardNo, InputType.text), "診察券番号", patient({ new_patient: true })),
      ).toEqual({
        kind: "fill",
        value: "新患",
      });
      expect(
        planField(
          key(FieldNo.patientCardNo, InputType.text),
          "診察券番号",
          patient({ new_patient: true, patient_card_no: undefined }),
        ),
      ).toEqual({ kind: "fill", value: "新患" });
    });
    it("再診で番号なし: 必須は MissingValueError", () => {
      expect(() =>
        planField(
          key(FieldNo.patientCardNo, InputType.text, true),
          "診察券番号",
          patient({ patient_card_no: undefined }),
        ),
      ).toThrow(MissingValueError);
    });
    it("再診で番号なし: 任意は skip", () => {
      expect(
        planField(
          key(FieldNo.patientCardNo, InputType.text, false),
          "診察券番号",
          patient({ patient_card_no: undefined }),
        ),
      ).toMatchObject({
        kind: "skip",
      });
    });
  });

  describe("新患フラグ (fieldNo=6)", () => {
    it("text/textarea は 新患 / 再診 を入力", () => {
      expect(planField(key(FieldNo.newPatientFlg, InputType.text), "初診", patient({ new_patient: true }))).toEqual({
        kind: "fill",
        value: "新患",
      });
      expect(planField(key(FieldNo.newPatientFlg, InputType.textarea), "初診", patient())).toEqual({
        kind: "fill",
        value: "再診",
      });
    });
    it("radio は新患なら 新患/初診 系ラベル", () => {
      const a = planField(key(FieldNo.newPatientFlg, InputType.radio), "初診", patient({ new_patient: true }));
      expect(a.kind).toBe("radio");
      if (a.kind !== "radio") return;
      for (const l of ["新患", "初診", "初めて", "はじめて", "はい"]) expect(a.match?.test(l)).toBe(true);
      expect(a.match?.test("再診")).toBe(false);
    });
    it("radio は再診なら 再診/いいえ 系ラベル", () => {
      const a = planField(key(FieldNo.newPatientFlg, InputType.radio), "初診", patient());
      expect(a.kind).toBe("radio");
      if (a.kind !== "radio") return;
      for (const l of ["再診", "いいえ", "2回目", "二回目"]) expect(a.match?.test(l)).toBe(true);
      expect(a.match?.test("新患")).toBe(false);
    });
  });

  describe("呼出時間など (fieldNo=7)", () => {
    it("custom_fields の値を型に応じて返す", () => {
      const p = patient({ custom_fields: { 呼出: "電話" } });
      expect(planField(key(FieldNo.callTime, InputType.text), "呼出方法", p)).toEqual({ kind: "fill", value: "電話" });
      expect(planField(key(FieldNo.callTime, InputType.select), "呼出方法", p)).toEqual({
        kind: "select",
        value: "電話",
      });
    });
    it("未設定: 必須は MissingValueError / 任意は skip", () => {
      expect(() => planField(key(FieldNo.callTime, InputType.text, true), "呼出方法", patient())).toThrow(
        MissingValueError,
      );
      expect(planField(key(FieldNo.callTime, InputType.text, false), "呼出方法", patient())).toMatchObject({
        kind: "skip",
      });
    });
  });

  describe("フリガナ (fieldNo=8)", () => {
    it("name_kana を入力", () => {
      expect(planField(key(FieldNo.nameKana, InputType.text), "フリガナ", patient())).toEqual({
        kind: "fill",
        value: "ヤマダ タロウ",
      });
    });
    it("未設定: 必須は MissingValueError / 任意は skip", () => {
      expect(() =>
        planField(key(FieldNo.nameKana, InputType.text, true), "フリガナ", patient({ name_kana: undefined })),
      ).toThrow(MissingValueError);
      expect(
        planField(key(FieldNo.nameKana, InputType.text, false), "フリガナ", patient({ name_kana: undefined })),
      ).toMatchObject({
        kind: "skip",
      });
    });
  });

  describe("医院独自項目 (fieldNo=0)", () => {
    const p = patient({ custom_fields: { 症状: "鼻水", アレルギー: "花粉,卵" } });
    it("タイトル部分一致で値を入れる", () => {
      expect(planField(key(FieldNo.custom, InputType.textarea), "現在の症状", p)).toEqual({
        kind: "fill",
        value: "鼻水",
      });
    });
    it("checkbox は複数値", () => {
      expect(planField(key(FieldNo.custom, InputType.checkbox), "アレルギー", p)).toEqual({
        kind: "checkbox",
        values: ["花粉", "卵"],
      });
    });
    it("radio / select", () => {
      expect(planField(key(FieldNo.custom, InputType.radio), "症状", p)).toEqual({ kind: "radio", value: "鼻水" });
      expect(planField(key(FieldNo.custom, InputType.select), "症状", p)).toEqual({ kind: "select", value: "鼻水" });
    });
    it("値なし: 必須は MissingValueError (メッセージにタイトルと患者ラベル)", () => {
      expect(() => planField(key(FieldNo.custom, InputType.text, true), "住所", p, "taro: ")).toThrow(
        /taro: 必須項目「住所」/,
      );
      expect(() => planField(key(FieldNo.custom, InputType.text, true), "住所", p)).toThrow(MissingValueError);
    });
    it("値なし: 任意は skip", () => {
      expect(planField(key(FieldNo.custom, InputType.text, false), "住所", p)).toMatchObject({ kind: "skip" });
    });
  });

  describe("未知の fieldNo (9 以上)", () => {
    it("custom と同様に扱う", () => {
      const p = patient({ custom_fields: { 備考: "なし" } });
      expect(planField(key(99, InputType.text), "備考", p)).toEqual({ kind: "fill", value: "なし" });
      expect(() => planField(key(99, InputType.text, true), "その他", p)).toThrow(MissingValueError);
    });
  });

  it("fieldNo 0〜8 の全てが例外なく処理できる (全項目が揃った患者)", () => {
    const p = patient({ custom_fields: { 項目: "v" } });
    for (let no = 0; no <= 8; no++) {
      for (const t of Object.values(InputType)) {
        expect(() => planField(key(no, t), "項目", p)).not.toThrow();
      }
    }
  });
});
