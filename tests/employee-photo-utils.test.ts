import { describe, expect, it } from "vitest";
import { normalizeEmployeePhotoValue } from "@/app/lib/photo";

describe("employee photo normalization", () => {
  it("drops blank values and keeps valid remote or data URLs", () => {
    expect(normalizeEmployeePhotoValue("   ")).toBeNull();
    expect(normalizeEmployeePhotoValue("https://cdn.example.com/employee.png")).toBe(
      "https://cdn.example.com/employee.png"
    );
    expect(normalizeEmployeePhotoValue("data:image/png;base64,AAAA")).toBe(
      "data:image/png;base64,AAAA"
    );
    expect(normalizeEmployeePhotoValue("/images/employee.png")).toBe("/images/employee.png");
  });
});
