/**
 * The shared avatar module behind the employee directory.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The directory renders twice — a card list below `md` and a table from `md`
 * up — and each view used to carry its own copy of the initials expression and
 * its own gradient. That is how a person ends up indigo on a phone and
 * something else on a laptop: the colour is the fastest way for a user to
 * recognise a row, and it has to mean the same thing in both places.
 *
 * WHAT IS PROVEN HERE
 * -------------------
 * The palette functions are plain TypeScript with no DOM, no React and no
 * layout, so unlike the rest of the directory these assertions are BEHAVIOURAL
 * — they call the real functions and check what they actually return. The
 * guarantee that BOTH views use them is structural and lives in
 * `employee-list-design-structure.test.ts`.
 *
 * What is NOT proven: that a gradient looks right in a browser. These tests
 * prove the same employee always receives the same class string, which is the
 * part that can silently regress.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    EMPLOYEE_AVATAR_PALETTES,
    employeeAvatarPalette,
    employeeInitials,
} from "@/app/employees/employee-avatar";

const ROOT = process.cwd();
const AVATAR_FILE = join(ROOT, "app", "employees", "employee-avatar.tsx");

type Employee = { id: string; firstName: string; lastName: string; photo?: string | null };

const DIRECTORY: Employee[] = [
    { id: "e1", firstName: "Aisha", lastName: "Usmani" },
    { id: "e2", firstName: "Mohammed", lastName: "Uthman" },
    { id: "e3", firstName: "Sara", lastName: "Ul" },
    { id: "e4", firstName: "Imran", lastName: "Iqbal" },
    { id: "e5", firstName: "Hina", lastName: "Iqbal" },
    { id: "e6", firstName: "Bilal", lastName: "Anwar" },
    { id: "e7", firstName: "Ayesha", lastName: "Nasser" },
    { id: "e8", firstName: "Omar", lastName: "Farooq" },
];

describe("employee avatar — initials", () => {
    it("takes the first glyph of the first and last name", () => {
        expect(employeeInitials(DIRECTORY[0])).toBe("AU");
        expect(employeeInitials({ firstName: "Mohammed", lastName: "Uthman" })).toBe("MU");
        expect(employeeInitials({ firstName: "Sara", lastName: "Ul" })).toBe("SU");
    });

    it("is case independent on the way in and normalised on the way out", () => {
        expect(employeeInitials({ firstName: "aisha", lastName: "usmani" })).toBe("AU");
    });

    it("survives a missing name rather than throwing", () => {
        // The old table markup did `employee.firstName[0]`, which throws on a
        // record with no first name and takes the whole directory down.
        expect(employeeInitials({ firstName: "Aisha" })).toBe("A");
        expect(employeeInitials({ lastName: "Usmani" })).toBe("U");
        expect(employeeInitials({ firstName: "", lastName: "" })).toBe("?");
        expect(employeeInitials(null)).toBe("?");
        expect(employeeInitials(undefined)).toBe("?");
    });

    it("ignores padding, which would otherwise yield a space as the glyph", () => {
        expect(employeeInitials({ firstName: "  Aisha  ", lastName: "  Usmani " })).toBe("AU");
    });
});

describe("employee avatar — one colour per person", () => {
    it("always returns a palette from the declared list", () => {
        for (const employee of DIRECTORY) {
            expect(EMPLOYEE_AVATAR_PALETTES).toContain(employeeAvatarPalette(employee));
        }
    });

    it("is stable across calls, so a re-render never repaints a person", () => {
        for (const employee of DIRECTORY) {
            expect(employeeAvatarPalette(employee)).toBe(employeeAvatarPalette(employee));
            expect(employeeAvatarPalette(employee)).toBe(
                employeeAvatarPalette({ ...employee })
            );
        }
    });

    it("does not depend on the employee's POSITION in the list", () => {
        // A position-derived palette repaints the whole directory on every
        // keystroke in the search box and every status-filter change, so the
        // colour identifies a row rather than a person. Shuffling the list
        // must not move anyone.
        const forward = DIRECTORY.map(employeeAvatarPalette);
        const shuffled = [...DIRECTORY].reverse().map(employeeAvatarPalette).reverse();

        expect(shuffled).toEqual(forward);
    });

    it("survives filtering — the same record always keeps its colour", () => {
        const filtered = DIRECTORY.filter((e) => e.id !== "e2" && e.id !== "e5");
        for (const employee of filtered) {
            expect(employeeAvatarPalette(employee)).toBe(
                employeeAvatarPalette(DIRECTORY.find((d) => d.id === employee.id) as Employee)
            );
        }
    });

    it("actually distributes across the palette instead of returning one colour", () => {
        const used = new Set(DIRECTORY.map(employeeAvatarPalette));
        expect(used.size).toBeGreaterThan(1);
        expect(used.size).toBeLessThanOrEqual(EMPLOYEE_AVATAR_PALETTES.length);
    });

    it("falls back to the name when a record has no id", () => {
        const a = employeeAvatarPalette({ firstName: "Aisha", lastName: "Usmani" });
        const b = employeeAvatarPalette({ id: "e1", firstName: "Aisha", lastName: "Usmani" });
        // Different keys, so possibly different colours — but each must be
        // stable on its own terms.
        expect(a).toBe(employeeAvatarPalette({ firstName: "Aisha", lastName: "Usmani" }));
        expect(EMPLOYEE_AVATAR_PALETTES).toContain(a);
        expect(EMPLOYEE_AVATAR_PALETTES).toContain(b);
    });

    it("never returns an empty string for an empty record", () => {
        expect(EMPLOYEE_AVATAR_PALETTES).toContain(employeeAvatarPalette({}));
    });
});

describe("employee avatar — the class strings themselves", () => {
    const source = readFileSync(AVATAR_FILE, "utf8");

    it("declares at least four palettes", () => {
        expect(EMPLOYEE_AVATAR_PALETTES.length).toBeGreaterThanOrEqual(4);
    });

    it("never interpolates a class name", () => {
        // Tailwind scans SOURCE TEXT. `from-${hue}-500` produces tokens that
        // appear in no file, so the browser gets no rule and the circle falls
        // back to the default grey.
        for (const palette of EMPLOYEE_AVATAR_PALETTES) {
            expect(palette).not.toContain("${");
            expect(palette).not.toContain("`");
        }
    });

    it("every palette is a gradient plus a legible foreground", () => {
        for (const palette of EMPLOYEE_AVATAR_PALETTES) {
            expect(palette).toMatch(/bg-gradient-to-br/);
            expect(palette).toMatch(/from-\w+-\d{2,3}/);
            expect(palette).toMatch(/to-\w+-\d{2,3}/);
            expect(palette).toContain("text-white");
        }
    });

    it("uses no dead `animate-*` utility of its own", () => {
        const markup = source.slice(source.indexOf("export function EmployeeAvatar"));
        expect(markup).not.toMatch(/animate-in|fade-in-0|zoom-in-95|slide-in-from-/);
    });

    it("renders the initials inside the fallback, not as a sibling", () => {
        // A sibling would render both the photo and the initials at once.
        expect(source).toMatch(/<AvatarFallback[\s\S]{0,400}\{employeeInitials\(employee\)\}/);
        expect(source).toContain("employeeAvatarPalette(employee)");
    });

    it("marks the photo decorative, because the name is rendered beside it", () => {
        expect(source).toMatch(/<AvatarImage[^>]*alt=""/);
    });
});
