/**
 * Requisition code generation and vocabulary tests.
 *
 * `JobRequisition.requisitionCode` is `String? @unique` with the schema
 * comment "Unique so a requisition is addressable in approvals". The code is
 * therefore part of an audit trail that people quote to each other, which puts
 * two extra requirements on it: the format must be stable, and the sequence
 * must be monotonic. A `count() + 1` sequence is neither — a deleted row makes
 * it hand out a number that is already taken — so these tests pin the
 * read-the-maximum behaviour that the action actually uses.
 *
 * Pure functions, no mocks, no database.
 */
import { describe, it, expect } from "vitest";

import {
    formatRequisitionCode,
    nextRequisitionCode,
    requisitionCodePrefix,
    requisitionSchema,
    REQUISITION_PRIORITIES,
    REQUISITION_POSITION_TYPES,
    REQUISITION_EMPLOYMENT_TYPES,
} from "@/lib/recruitment/requisition-validation";

describe("the requisition code format", () => {
    it("matches REQ-<year>-<zero-padded sequence>", () => {
        expect(formatRequisitionCode(2026, 1)).toBe("REQ-2026-0001");
        expect(formatRequisitionCode(2026, 42)).toBe("REQ-2026-0042");
        expect(formatRequisitionCode(2026, 999)).toBe("REQ-2026-0999");
    });

    it("pads past four digits rather than truncating", () => {
        // A collision is still better than a truncated number, but the width
        // must not silently drop the thousands digit.
        expect(formatRequisitionCode(2026, 10000)).toBe("REQ-2026-10000");
    });

    it("derives the year prefix the action filters on", () => {
        expect(requisitionCodePrefix(2026)).toBe("REQ-2026-");
    });
});

describe("next code from the highest existing value", () => {
    it("starts at 0001 when the year is empty", () => {
        expect(nextRequisitionCode(null, 2026)).toBe("REQ-2026-0001");
        expect(nextRequisitionCode(undefined, 2026)).toBe("REQ-2026-0001");
    });

    it("increments the sequence", () => {
        expect(nextRequisitionCode("REQ-2026-0001", 2026)).toBe("REQ-2026-0002");
    });

    it("does not reuse a number left behind by a deleted requisition", () => {
        // Three rows exist, the middle one was deleted. A count-based sequence
        // would hand out REQ-2026-0003 again and hit the unique constraint.
        expect(nextRequisitionCode("REQ-2026-0004", 2026)).toBe("REQ-2026-0005");
    });

    it("ignores last year's codes", () => {
        // The sequence restarts each year, so the December tail must not push
        // January to 0020.
        expect(nextRequisitionCode("REQ-2025-0018", 2026)).toBe("REQ-2026-0001");
    });

    it("ignores a malformed or imported code rather than propagating NaN", () => {
        expect(nextRequisitionCode("REQ-2026-", 2026)).toBe("REQ-2026-0001");
        expect(nextRequisitionCode("LEGACY-CODE", 2026)).toBe("REQ-2026-0001");
        expect(nextRequisitionCode("REQ-2026-0000", 2026)).toBe("REQ-2026-0001");
    });

    it("never emits a code outside the format", () => {
        for (const latest of [null, "REQ-2026-0003", "junk", "REQ-2025-0009"]) {
            expect(nextRequisitionCode(latest, 2026)).toMatch(/^REQ-\d{4}-\d{4}$/);
        }
    });
});

/**
 * The model's `employmentType`, `positionType` and `priority` are plain String
 * columns, not database enums. Nothing below the application layer will ever
 * reject a nonsense value, so these assertions are the safety net.
 */
describe("the controlled vocabulary is enforced by the schema alone", () => {
    const base = {
        title: "Analyst",
        department: "Finance",
        employmentType: "FULL_TIME",
        positionsCount: 1,
        positionType: "NEW_POSITION",
        priority: "MEDIUM",
    };

    it("accepts every documented value", () => {
        for (const employmentType of REQUISITION_EMPLOYMENT_TYPES) {
            for (const positionType of REQUISITION_POSITION_TYPES) {
                for (const priority of REQUISITION_PRIORITIES) {
                    const result = requisitionSchema.safeParse({
                        ...base,
                        employmentType,
                        positionType,
                        priority,
                        // REPLACEMENT needs the employee it replaces.
                        ...(positionType === "REPLACEMENT" ? { replacementEmployeeId: "emp-1" } : {}),
                    });
                    expect(result.success, `${employmentType}/${positionType}/${priority}`).toBe(true);
                }
            }
        }
    });

    it("rejects a value outside each list", () => {
        expect(requisitionSchema.safeParse({ ...base, priority: "URGENTLY" }).success).toBe(false);
        expect(requisitionSchema.safeParse({ ...base, positionType: "BACKFILL" }).success).toBe(false);
        expect(requisitionSchema.safeParse({ ...base, employmentType: "FREELANCE" }).success).toBe(false);
        // Case matters: a lower-cased value is a different string, not a synonym.
        expect(requisitionSchema.safeParse({ ...base, priority: "high" }).success).toBe(false);
    });

    it("coerces the form's string fields and bounds the numbers", () => {
        const result = requisitionSchema.safeParse({ ...base, positionsCount: "3", budget: "1000" });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.positionsCount).toBe(3);
            expect(result.data.budget).toBe(1000);
        }
    });
});
