import { describe, expect, it } from "vitest";
import { parseFieldName } from "../../src/fill/field-key.js";

describe("parseFieldName", () => {
  it("通常の項目", () => {
    expect(parseFieldName("0_6860_1_1_1")).toEqual({
      name: "0_6860_1_1_1",
      patientIndex: 0,
      fieldId: 6860,
      fieldNo: 1,
      inputType: 1,
      required: true,
    });
  });

  it("日付の分割項目と任意項目", () => {
    expect(parseFieldName("1_6862_2_6_2_year")).toMatchObject({ patientIndex: 1, fieldNo: 2, inputType: 6, required: false, part: "year" });
    expect(parseFieldName("1_6862_2_6_1_date")?.part).toBe("date");
  });

  it.each(["", "agree", "0_1_2_3", "0_1_2_3_4_day", "a_1_2_3_4"])("%s は対象外", (n) => {
    expect(parseFieldName(n)).toBeUndefined();
  });
});
