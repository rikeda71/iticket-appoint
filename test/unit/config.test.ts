import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { maskPatient, parseConfig, resolveProfiles } from "../../src/config/load.js";
import { ConfigError } from "../../src/flow/errors.js";

const example = readFileSync(new URL("../../config.example.yaml", import.meta.url), "utf8");

const minimal = `
clinics:
  c: { owner_id: "2171", business_no: "01" }
patients:
  a: { name: 太郎, birth: "1990-01-02", phone: "09012345678" }
`;

describe("parseConfig", () => {
  it("config.example.yaml は妥当", () => {
    const cfg = parseConfig(example);
    expect(cfg.clinics.takeda?.owner_id).toBe("2171");
    expect(cfg.patients.taro?.new_patient).toBe(false);
    expect(cfg.patients.hanako?.custom_fields).toEqual({ 症状: "鼻水" });
  });

  it("省略値が入る", () => {
    const cfg = parseConfig(minimal);
    expect(cfg.wait).toEqual({ interval_sec: 20, jitter_sec: 3, max_attempts: 60, prewarm_sec: 60 });
    expect(cfg.browser).toEqual({ headless: true, timeout_ms: 15000 });
    expect(cfg.patients.a?.custom_fields).toEqual({});
  });

  it("数値で書かれた診察券番号・owner_id は文字列にする", () => {
    const cfg = parseConfig(minimal.replace('"2171"', "2171").replace("phone:", "patient_card_no: 123, phone:"));
    expect(cfg.clinics.c?.owner_id).toBe("2171");
    expect(cfg.patients.a?.patient_card_no).toBe("123");
  });

  it.each([
    ["interval_sec が 10 未満", minimal + "wait: { interval_sec: 5 }", "interval_sec"],
    ["存在しない日付", minimal.replace("1990-01-02", "1990-02-30"), "birth"],
    ["電話番号が短い", minimal.replace("09012345678", "090-1234"), "phone"],
    ["business_no が 2 桁でない", minimal.replace('"01"', '"1"'), "business_no"],
    ["business_no を数値で書いた (01 -> 1)", minimal.replace('"01"', "01"), "business_no"],
    ["defaults が未定義の patient を参照", minimal + "defaults: { patients: [zzz] }", "zzz"],
    ["defaults が未定義の clinic を参照", minimal + "defaults: { clinic: zzz }", "zzz"],
    ["deadline の形式", minimal + 'wait: { deadline: "9:30" }', "deadline"],
  ])("%s はエラー", (_, yaml, needle) => {
    expect(() => parseConfig(yaml)).toThrow(ConfigError);
    expect(() => parseConfig(yaml)).toThrow(needle);
  });

  it("YAML 構文エラー", () => {
    expect(() => parseConfig("clinics: [")).toThrow(/YAML/);
  });
});

describe("resolveProfiles", () => {
  const cfg = parseConfig(example);

  it("defaults を使う", () => {
    const r = resolveProfiles(cfg, {});
    expect(r.clinicKey).toBe("takeda");
    expect(r.patients.map((p) => p.key)).toEqual(["taro"]);
  });

  it("引数が優先され、カンマ区切りも受け付ける", () => {
    const r = resolveProfiles(cfg, { patients: ["taro,hanako"] });
    expect(r.patients.map((p) => p.key)).toEqual(["taro", "hanako"]);
    expect(resolveProfiles(cfg, { patients: ["hanako", "taro"] }).patients.map((p) => p.key)).toEqual([
      "hanako",
      "taro",
    ]);
  });

  it("clinic が 1 つだけなら defaults がなくても選ばれる", () => {
    const c = parseConfig(minimal);
    expect(resolveProfiles(c, { patients: ["a"] }).clinicKey).toBe("c");
  });

  it.each([
    [{ clinic: "nope" }, /未定義の clinic/],
    [{ patients: ["nope"] }, /未定義の patient/],
    [{ patients: ["taro", "taro"] }, /重複/],
    [{ patients: ["a,b,c,d,e,f"] }, /5 人まで/],
  ])("%o はエラー", (opts, re) => {
    expect(() => resolveProfiles(cfg, opts)).toThrow(re);
  });

  it("patients が解決できなければエラー", () => {
    expect(() => resolveProfiles(parseConfig(minimal), {})).toThrow(/--patient/);
  });
});

describe("maskPatient", () => {
  it("個人情報を伏せる", () => {
    const p = parseConfig(example).patients.taro!;
    const m = maskPatient(p);
    expect(m).toMatchObject({ name: "山***", patient_card_no: "*****", birth: "1990-**-**", phone: "090********" });
    expect(JSON.stringify(m)).not.toContain("太郎");
  });
});
