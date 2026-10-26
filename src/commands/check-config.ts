import { loadConfig, maskPatient } from "../config/load.js";
import { businessTopUrl } from "../site/urls.js";

export function checkConfig(configPath: string): void {
  const cfg = loadConfig(configPath);
  console.log(`OK: ${configPath}`);
  console.log("\n[clinics]");
  for (const [k, c] of Object.entries(cfg.clinics)) {
    console.log(`  ${k}: ${c.name ?? ""} ${businessTopUrl(c)}${c.frame ? ` (枠: ${c.frame})` : ""}`);
  }
  console.log("\n[patients]");
  for (const [k, p] of Object.entries(cfg.patients)) {
    console.log(`  ${k}: ${JSON.stringify(maskPatient(p))}`);
  }
  console.log("\n[defaults]", JSON.stringify(cfg.defaults));
  console.log("[wait]", JSON.stringify(cfg.wait));
  console.log("[browser]", JSON.stringify(cfg.browser));
}
