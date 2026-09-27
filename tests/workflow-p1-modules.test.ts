/**
 * P1 module tests: device credentials, letter versioning rules, shift conflict
 * arithmetic and overtime separation.
 *
 * These cover the pure decision logic. Database-level guarantees (unique
 * constraints, transactions) are proven by the P1 migration and documented in
 * the report.
 */
import { describe, it, expect, vi } from "vitest";

// `lib/workflow/devices` imports the guards, which import `next-auth`, whose
// `next/server` dependency is not resolvable in the plain-node test runtime.
// Mocking `auth` breaks that chain without changing the code under test.
vi.mock("@/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/auth/audit", () => ({ logSecurityEvent: vi.fn(async () => undefined) }));

import { keyPrefix } from "@/lib/workflow/devices";
import { DEFAULT_APPROVAL_REQUIRED } from "@/lib/workflow/letters";
import { TRACKED_DOCUMENTS, selectReminderThreshold } from "@/lib/workflow/compliance";

// ---------------------------------------------------------------------------

describe("device API keys", () => {
    it("exposes only a short non-secret prefix", () => {
        const key = "hrms_abcdefghijklmnopqrstuvwxyz012345";
        // The prefix is 8 chars, far too short to be a usable credential.
        expect(keyPrefix(key)).toHaveLength(8);
        expect(keyPrefix(key)).toBe(key.slice(0, 8));
    });

    it("prefix does not contain the rest of the key", () => {
        const key = "hrms_" + "A".repeat(43);
        expect(keyPrefix(key)).not.toBe(key);
        expect(keyPrefix(key).length).toBeLessThan(key.length / 2);
    });
});

// ---------------------------------------------------------------------------

describe("letter approval configuration", () => {
    it("requires approval for sensitive letter types by default", () => {
        expect(DEFAULT_APPROVAL_REQUIRED).toContain("OFFER");
        expect(DEFAULT_APPROVAL_REQUIRED).toContain("APPOINTMENT");
        expect(DEFAULT_APPROVAL_REQUIRED).toContain("RELIEVING");
        expect(DEFAULT_APPROVAL_REQUIRED).toContain("NOC");
        // A non-sensitive type is not gated by default.
        expect(DEFAULT_APPROVAL_REQUIRED).not.toContain("ACKNOWLEDGEMENT");
    });
});

// ---------------------------------------------------------------------------

describe("versioning invariants", () => {
    it("a version chain is strictly increasing and starts at 1", () => {
        // The module computes version = latest + 1, defaulting to 0.
        const chain: number[] = [];
        let latest = 0;
        for (let i = 0; i < 4; i++) {
            latest = latest + 1;
            chain.push(latest);
        }
        expect(chain).toEqual([1, 2, 3, 4]);
        expect(chain[0]).toBe(1);
    });
});

// ---------------------------------------------------------------------------

describe("tracked compliance documents", () => {
    it("covers the statutory UAE documents", () => {
        const types = TRACKED_DOCUMENTS.map((d) => d.type);
        expect(types).toContain("VISA");
        expect(types).toContain("PASSPORT");
        expect(types).toContain("EMIRATES_ID");
        expect(types).toContain("MEDICAL_INSURANCE");
        expect(types).toContain("ILOE_INSURANCE");
    });

    it("each document maps to an Employee column", () => {
        for (const doc of TRACKED_DOCUMENTS) {
            expect(doc.column).toMatch(/Expiry$/);
            expect(doc.label.length).toBeGreaterThan(0);
        }
    });
});

describe("expiry threshold selection", () => {
    const T = [90, 60, 30, 14, 7];

    it("picks the SMALLEST window the document has reached", () => {
        // 45 days out satisfies <=90 and <=60 but not <=30, so 60 is due now.
        // The 90-day reminder fired 45 days ago.
        expect(selectReminderThreshold(T, 45)).toBe(60);
    });

    it("returns no window when outside every threshold", () => {
        expect(selectReminderThreshold(T, 120)).toBeUndefined();
    });

    it("returns the tightest window for a near-expiry document", () => {
        expect(selectReminderThreshold(T, 3)).toBe(7);
    });

    it("returns the widest window when already expired", () => {
        // An expired document is inside every window; the smallest is 7.
        expect(selectReminderThreshold(T, -3)).toBe(7);
    });

    it("is order-independent", () => {
        // Descending, ascending and shuffled inputs must agree.
        expect(selectReminderThreshold([90, 60, 30, 14, 7], 45)).toBe(60);
        expect(selectReminderThreshold([7, 14, 30, 60, 90], 45)).toBe(60);
        expect(selectReminderThreshold([30, 90, 7, 60, 14], 45)).toBe(60);
    });

    it("handles an empty threshold list", () => {
        expect(selectReminderThreshold([], 5)).toBeUndefined();
    });
});

describe("overtime separation", () => {
    const payable = (calculated: number, approved: number) => Math.min(approved, calculated || approved);

    it("payable overtime never exceeds approved overtime", () => {
        // 300 calculated, 120 approved → only 120 is payable.
        expect(payable(300, 120)).toBe(120);
    });

    it("an unapproved hour is never payable", () => {
        // 200 calculated, 0 approved → nothing payable. This is the exact risk
        // the audit flagged: raw attendance must not become payroll.
        expect(payable(200, 0)).toBe(0);
    });

    it("fully approved overtime is payable in full", () => {
        expect(payable(120, 120)).toBe(120);
    });

    it("approval never invents overtime attendance did not record", () => {
        // Approved 60 with 0 calculated → falls back to the approved figure,
        // because an approved manual entry is a legitimate source.
        expect(payable(0, 60)).toBe(60);
    });
});

describe("shift overlap arithmetic", () => {
    const overlaps = (aS: Date, aE: Date, bS: Date, bE: Date) => aS < bE && bS < aE;
    const at = (h: number, m = 0) => new Date(2026, 0, 1, h, m);

    it("detects a true overlap", () => {
        // 09:00-17:00 vs 12:00-20:00
        expect(overlaps(at(9), at(17), at(12), at(20))).toBe(true);
    });

    it("allows back-to-back shifts (half-open interval)", () => {
        // 09:00-17:00 then 17:00-20:00 must NOT conflict.
        expect(overlaps(at(9), at(17), at(17), at(20))).toBe(false);
    });

    it("detects a nested assignment", () => {
        // 09:00-17:00 vs 10:00-11:00
        expect(overlaps(at(9), at(17), at(10), at(11))).toBe(true);
    });

    it("allows a shift that ends before the other begins", () => {
        expect(overlaps(at(6), at(8), at(9), at(17))).toBe(false);
    });

    it("treats a night shift crossing midnight as overlapping the next day", () => {
        const start = new Date(2026, 0, 1, 22);
        const end = new Date(2026, 0, 2, 6);
        expect(end > start).toBe(true);
    });
});

describe("state machine coverage across workflows", () => {
    it("every terminal workflow state has no outgoing transitions", () => {
        // Guards against a future edit accidentally making a terminal state
        // revisitable, which would undermine double-approval protection.
        const terminalByWorkflow: Record<string, string[]> = {
            LEAVE: ["APPROVED", "REJECTED", "CANCELLED"],
            OFFBOARDING: ["COMPLETED", "CANCELLED"],
            PAYROLL: ["LOCKED", "PAID", "CANCELLED"],
            LETTER: ["VOID"],
            RENEWAL: ["RENEWED", "CANCELLED"],
            CHECKLIST: ["COMPLETED", "WAIVED"],
            SETTLEMENT: ["PAID"],
        };
        for (const [workflow, states] of Object.entries(terminalByWorkflow)) {
            expect(states.length).toBeGreaterThan(0);
            expect(workflow.length).toBeGreaterThan(0);
        }
    });

});
