import { z } from "zod";

export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmm = z.string().regex(HHMM_RE, "HH:MM 形式で指定してください (例: 09:00)");

function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export const clinicSchema = z.object({
  owner_id: z.coerce.string().regex(/^\d+$/, "owner_id は数字 (URL の /clinics/{owner_id}) です"),
  business_no: z.coerce
    .string()
    .regex(/^\d{2}$/, 'business_no は 2 桁の文字列です (例: "01")。YAML では必ずクォートしてください'),
  name: z.string().optional(),
  /** 枠名 (例: "午前") の部分一致。省略時は予約可能な最初の枠 */
  frame: z.string().optional(),
  /** キャンセル可能な枠で求められる 4 桁のキャンセルコード */
  cancel_code: z.coerce
    .string()
    .regex(/^\d{4}$/, "cancel_code は 4 桁の数字です")
    .optional(),
});

export const patientSchema = z.object({
  name: z.string().trim().min(1),
  name_kana: z.string().trim().optional(),
  patient_card_no: z.coerce.string().trim().optional(),
  birth: z.string().refine(isRealDate, "birth は実在する日付を YYYY-MM-DD で指定してください"),
  phone: z.coerce.string().refine((s) => s.replace(/\D/g, "").length >= 10, "phone は数字 10 桁以上で指定してください"),
  sex: z.enum(["male", "female"]).optional(),
  new_patient: z.boolean().default(false),
  /** 医院独自の入力項目: 項目タイトル (部分一致) -> 値 */
  custom_fields: z.record(z.string(), z.coerce.string()).default({}),
});

export const waitSchema = z.object({
  interval_sec: z.number().int().min(10, "サイト負荷に配慮して interval_sec は 10 以上にしてください").default(20),
  jitter_sec: z.number().min(0).max(30).default(3),
  max_attempts: z.number().int().min(1).max(500).default(60),
  /** この時刻を過ぎたら諦める */
  deadline: hhmm.optional(),
  /** 目標時刻の何秒前にブラウザを起動しておくか */
  prewarm_sec: z.number().int().min(0).max(600).default(60),
});

export const browserSchema = z.object({
  headless: z.boolean().default(true),
  timeout_ms: z.number().int().min(1000).default(15_000),
});

export const configSchema = z
  .object({
    defaults: z
      .object({
        clinic: z.string().optional(),
        patients: z.array(z.string()).optional(),
        wait_until: hhmm.optional(),
      })
      .default({}),
    clinics: z.record(z.string(), clinicSchema).refine((r) => Object.keys(r).length > 0, "clinics が空です"),
    patients: z.record(z.string(), patientSchema).refine((r) => Object.keys(r).length > 0, "patients が空です"),
    wait: waitSchema.default(waitSchema.parse({})),
    browser: browserSchema.default(browserSchema.parse({})),
  })
  .superRefine((cfg, ctx) => {
    const { clinic, patients } = cfg.defaults;
    if (clinic !== undefined && !(clinic in cfg.clinics)) {
      ctx.addIssue({ code: "custom", path: ["defaults", "clinic"], message: `未定義の clinic: ${clinic}` });
    }
    for (const p of patients ?? []) {
      if (!(p in cfg.patients)) {
        ctx.addIssue({ code: "custom", path: ["defaults", "patients"], message: `未定義の patient: ${p}` });
      }
    }
  });

export type Config = z.infer<typeof configSchema>;
export type Clinic = z.infer<typeof clinicSchema>;
export type Patient = z.infer<typeof patientSchema>;
export type WaitConfig = z.infer<typeof waitSchema>;
export type BrowserConfig = z.infer<typeof browserSchema>;
