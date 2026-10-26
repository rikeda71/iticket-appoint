import { describe, expect, it } from "vitest";
import type { ResolvedPatient } from "../../src/config/load.js";
import { AppError, MissingValueError } from "../../src/flow/errors.js";
import { planFields } from "../../src/pages/input.js";

const patient = (key: string, over: Partial<ResolvedPatient> = {}): ResolvedPatient => ({
  key,
  name: `${key}の名前`,
  name_kana: "カナ",
  patient_card_no: "100",
  birth: "1990-01-02",
  phone: "09012345678",
  sex: "male",
  new_patient: false,
  custom_fields: {},
  ...over,
});

const one = [
  { name: "1_10_1_1_1", title: "氏名" },
  { name: "1_11_2_5_1_year", title: "生年月日" },
  { name: "1_11_2_5_1_month", title: "生年月日" },
  { name: "1_11_2_5_1_date", title: "生年月日" },
  { name: "1_12_3_2_1", title: "性別" },
];

describe("planFields", () => {
  it("1 人分: 各欄に action が付く", () => {
    const r = planFields(one, [patient("taro")]);
    expect(r).toHaveLength(5);
    expect(r[0]).toMatchObject({ title: "氏名", action: { kind: "fill", value: "taroの名前" } });
    expect(r.slice(1, 4).map((f) => f.action)).toEqual([
      { kind: "select", value: "1990" },
      { kind: "select", value: "1" },
      { kind: "select", value: "2" },
    ]);
    expect(r[4]?.action).toMatchObject({ kind: "radio", value: "0" });
    expect(r.every((f) => f.patient.key === "taro")).toBe(true);
  });

  it("パースできない name は無視する", () => {
    const r = planFields([...one, { name: "cancelCode", title: "" }, { name: "foo", title: "" }], [patient("taro")]);
    expect(r).toHaveLength(5);
  });

  it("2 人分: 患者番号の昇順で患者に対応付ける", () => {
    const raw = [
      { name: "2_20_1_1_1", title: "氏名" },
      { name: "1_10_1_1_1", title: "氏名" },
    ];
    const r = planFields(raw, [patient("taro"), patient("hanako")]);
    expect(r[0]?.patient.key).toBe("hanako");
    expect(r[0]?.action).toEqual({ kind: "fill", value: "hanakoの名前" });
    expect(r[1]?.patient.key).toBe("taro");
  });

  it("患者番号が 1 始まりでなくても出現順で対応付ける", () => {
    const r = planFields([{ name: "0_10_1_1_1", title: "氏名" }], [patient("taro")]);
    expect(r[0]?.patient.key).toBe("taro");
  });

  it("複数人のとき、エラーメッセージに患者キーが付く", () => {
    const raw = [
      { name: "1_10_1_1_1", title: "氏名" },
      { name: "2_21_8_1_1", title: "フリガナ" },
    ];
    const ps = [patient("taro"), patient("hanako", { name_kana: undefined })];
    expect(() => planFields(raw, ps)).toThrow(MissingValueError);
    expect(() => planFields(raw, ps)).toThrow(/hanako: /);
  });

  it("1 人のときはエラーメッセージに患者キーを付けない", () => {
    const raw = [{ name: "1_21_8_1_1", title: "フリガナ" }];
    expect(() => planFields(raw, [patient("taro", { name_kana: undefined })])).toThrow(/^必須項目/);
  });

  it("画面の人数と患者数が不一致なら AppError", () => {
    const two = [...one, { name: "2_20_1_1_1", title: "氏名" }];
    expect(() => planFields(two, [patient("taro")])).toThrow(/人数 \(2\).*患者数 \(1\)/);
    expect(() => planFields(one, [patient("taro"), patient("hanako")])).toThrow(AppError);
  });

  it("パースできる欄がゼロなら AppError", () => {
    expect(() => planFields([], [patient("taro")])).toThrow(/入力欄が見つかりません/);
    expect(() => planFields([{ name: "foo", title: "x" }], [patient("taro")])).toThrow(AppError);
  });

  it("医院独自項目はタイトルで custom_fields と照合する", () => {
    const r = planFields([{ name: "1_30_0_4_0", title: "症状" }], [patient("taro", { custom_fields: { 症状: "鼻水" } })]);
    expect(r[0]?.action).toEqual({ kind: "fill", value: "鼻水" });
  });

  it("任意で値なしの独自項目は skip", () => {
    const r = planFields([{ name: "1_30_0_4_0", title: "症状" }], [patient("taro")]);
    expect(r[0]?.action).toMatchObject({ kind: "skip" });
  });
});
