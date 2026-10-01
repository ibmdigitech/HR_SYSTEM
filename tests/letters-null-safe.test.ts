import { describe, expect, it } from "vitest";
import {
  getLetterEmployeeDisplayName,
  getLetterEmployeeInitials,
} from "@/app/lib/letters-safe";

describe("letters null-safety", () => {
  it("falls back gracefully when employee relation is missing", () => {
    expect(getLetterEmployeeDisplayName(null)).toBe("Unknown employee");
    expect(getLetterEmployeeDisplayName({ firstName: "Aisha", lastName: "Usmani" })).toBe("Aisha Usmani");
    expect(getLetterEmployeeInitials(null)).toBe("?");
    expect(getLetterEmployeeInitials({ firstName: "Aisha", lastName: "Usmani" })).toBe("AU");
  });
});
