import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { ConfigError } from "../flow/errors.js";
import { configSchema, type Clinic, type Config, type Patient } from "./schema.js";

export const MAX_PATIENTS = 5;

export function defaultConfigPath(): string {
  return process.env.ITICKET_CONFIG ?? "config.yaml";
}

export function parseConfig(text: string, source = "config"): Config {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    throw new ConfigError(`${source}: YAML の構文エラー: ${(e as Error).message}`);
  }
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new ConfigError(`${source}: 設定が不正です\n${lines.join("\n")}`);
  }
  return result.data;
}

export function loadConfig(path = defaultConfigPath()): Config {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new ConfigError(`設定ファイルを読めません: ${path} (config.example.yaml をコピーして作成してください)`);
  }
  return parseConfig(text, path);
}

export interface ResolvedPatient extends Patient {
  key: string;
}

export interface Resolved {
  clinicKey: string;
  clinic: Clinic;
  patients: ResolvedPatient[];
}

/** --clinic (なければ defaults.clinic、医院が 1 つならそれ) を解決する */
export function resolveClinic(cfg: Config, key?: string): { clinicKey: string; clinic: Clinic } {
  const clinicKey = key ?? cfg.defaults.clinic ?? (Object.keys(cfg.clinics).length === 1 ? Object.keys(cfg.clinics)[0] : undefined);
  if (!clinicKey) throw new ConfigError("--clinic を指定するか defaults.clinic を設定してください");
  const clinic = cfg.clinics[clinicKey];
  if (!clinic) throw new ConfigError(`未定義の clinic: ${clinicKey} (候補: ${Object.keys(cfg.clinics).join(", ")})`);
  return { clinicKey, clinic };
}

/** CLI 引数 (なければ defaults) からプロファイルを解決する。patients はカンマ区切りも受け付ける */
export function resolveProfiles(cfg: Config, opts: { clinic?: string; patients?: string[] }): Resolved {
  const { clinicKey, clinic } = resolveClinic(cfg, opts.clinic);

  const keys = (opts.patients && opts.patients.length > 0 ? opts.patients : cfg.defaults.patients ?? [])
    .flatMap((p) => p.split(","))
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (keys.length === 0) throw new ConfigError("--patient を指定するか defaults.patients を設定してください");
  if (new Set(keys).size !== keys.length) throw new ConfigError(`patient が重複しています: ${keys.join(", ")}`);
  if (keys.length > MAX_PATIENTS) throw new ConfigError(`一度に予約できるのは ${MAX_PATIENTS} 人までです`);

  const patients = keys.map((key) => {
    const p = cfg.patients[key];
    if (!p) throw new ConfigError(`未定義の patient: ${key} (候補: ${Object.keys(cfg.patients).join(", ")})`);
    return { key, ...p };
  });
  return { clinicKey, clinic, patients };
}

/** ログ・表示用に個人情報をマスクする */
export function maskPatient(p: Patient): Record<string, unknown> {
  const mask = (s: string | undefined, keep = 1) =>
    s === undefined ? undefined : s.slice(0, keep) + "*".repeat(Math.max(0, s.length - keep));
  return {
    name: mask(p.name),
    name_kana: mask(p.name_kana),
    patient_card_no: mask(p.patient_card_no, 0),
    birth: p.birth.slice(0, 4) + "-**-**",
    phone: mask(p.phone.replace(/\D/g, ""), 3),
    sex: p.sex,
    new_patient: p.new_patient,
    custom_fields: Object.keys(p.custom_fields),
  };
}
