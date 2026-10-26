import type { Clinic } from "../config/schema.js";

export const BASE_URL = process.env.ITICKET_BASE_URL ?? "https://park.paa.jp/park2";

export function businessTopUrl(c: Pick<Clinic, "owner_id" | "business_no">): string {
  return `${BASE_URL}/clinics/${c.owner_id}/businesses/${c.business_no}`;
}

export function newBookingUrl(c: Pick<Clinic, "owner_id" | "business_no">, newPatient = false): string {
  return `${businessTopUrl(c)}/bookings/${newPatient ? "new_patient" : "new"}`;
}

/** pathname 判定用 (クエリ・末尾スラッシュは無視) */
export const PATH = {
  input: /\/bookings\/new(?:_patient)?\/\d{8}\/frames\/[^/]+\/input\/?$|\/frames\/[^/]+\/input\/?$/,
  confirm: /\/bookings\/new(?:_patient)?_confirm\/?$/,
  complete: /\/bookings\/new(?:_patient)?_complete\/?$/,
  newBooking: /\/bookings\/new(?:_patient)?\/?$/,
} as const;

export function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
