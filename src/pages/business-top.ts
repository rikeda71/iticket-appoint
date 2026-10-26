import type { Page } from "playwright";
import type { Clinic } from "../config/schema.js";
import { TOP } from "../site/selectors.js";
import { businessTopUrl } from "../site/urls.js";

export interface BusinessTop {
  clinicName: string;
  businessName: string;
  /** order = 順番予約 / timezone = 時間帯予約 */
  mode: "order" | "timezone" | "unknown";
  /** 「診察時間外」など。受付中は undefined */
  nonService?: string;
  /** 「予約へ」リンクの有無 (時間外でも表示されることがある) */
  hasBookLink: boolean;
  /** 待ち状況パネルのテキスト (改行・空白を整形済み) */
  situation: string;
}

export const squash = (s: string) =>
  s
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0)
    .join(" / ");

export async function openBusinessTop(page: Page, clinic: Clinic): Promise<void> {
  await page.goto(businessTopUrl(clinic), { waitUntil: "domcontentloaded" });
  await waitBusinessTop(page);
}

export async function waitBusinessTop(page: Page): Promise<void> {
  await page.locator(TOP.situationRoot).first().waitFor({ state: "visible" });
}

export async function readBusinessTop(page: Page): Promise<BusinessTop> {
  const text = async (sel: string) => {
    const l = page.locator(sel).first();
    return (await l.count()) > 0 ? ((await l.textContent()) ?? "").trim() : "";
  };
  const mode =
    (await page.locator(TOP.situationOrder).count()) > 0
      ? "order"
      : (await page.locator(TOP.situationTimezone).count()) > 0
        ? "timezone"
        : "unknown";
  const nonService = await text(TOP.nonService);
  const body = page.locator(TOP.situationBody).first();
  return {
    clinicName: await text(TOP.clinicName),
    businessName: ((await page.locator(TOP.businessName).count()) === 0
      ? ""
      : await page
          .locator(TOP.businessName)
          .first()
          .evaluate((el) => el.firstChild?.textContent ?? "")
          .catch(() => "")
    ).trim(),
    mode,
    ...(nonService ? { nonService } : {}),
    hasBookLink: (await page.locator(TOP.bookLink).count()) > 0,
    situation: (await body.count()) > 0 ? squash(await body.innerText()) : "",
  };
}
