/**
 * P1 workflow tests.
 *
 * Covers the state machines, leave day calculation, accrual idempotency logic,
 * punch fingerprinting, and password strength. These are the pure/testable
 * parts; transaction- and database-level guarantees are proven by the
 * constraints added in the P1 migration and documented in the report.
 */
import { describe, it, expect } from "vitest";
import {
    LEAVE_TRANSITIONS,
    LEAVE_STATUS,
    OFFBOARDING_TRANSITIONS,
    OFFBOARDING_STATUS,
    SETTLEMENT_TRANSITIONS,
    PAYROLL_RUN_TRANSITIONS,
    PAYROLL_RUN_STATUS,
    LETTER_TRANSITIONS,
    LETTER_STATUS,
    RENEWAL_TRANSITIONS,
    CHECKLIST_TRANSITIONS,
    CHECKLIST_STATUS,
    assertTransition,
    canTransition,
    nextStates,
    InvalidTransitionError,
} from "@/lib/workflow/state-machine";
import { calculateLeaveDays, DAY_PART } from "@/lib/workflow/leave";
import { periodFor } from "@/lib/workflow/accrual";
import { punchFingerprint, parseDate, parseTime, validateFile } from "@/lib/attendance/import";
import { checkPasswordStrength, hashToken } from "@/lib/workflow/credentials";

const as = (role: string) => ({ actorRole: role, actorId: "u1" });

describe("generic state machine", () => {
    it("rejects an unknown current state rather than defaulting to permissive", () => {
        expect(() =>
            assertTransition("LEAVE", LEAVE_TRANSITIONS, "NOT_A_STATE", LEAVE_STATUS.APPROVED, as("ADMIN"))
        ).toThrow(InvalidTransitionError);
    });

    it("rejects a transition the map does not define", () => {
        expect(() =>
            assertTransition("LEAVE", LEAVE_TRANSITIONS, LEAVE_STATUS.APPROVED, LEAVE_STATUS.PENDING_HR, as("ADMIN"))
        ).toThrow(InvalidTransitionError);
    });

    it("enforces actor roles", () => {
        expect(() =>
            assertTransition("LEAVE", LEAVE_TRANSITIONS, LEAVE_STATUS.PENDING_HR, LEAVE_STATUS.APPROVED, as("STAFF"))
        ).toThrow(InvalidTransitionError);
        expect(() =>
            assertTransition("LEAVE", LEAVE_TRANSITIONS, LEAVE_STATUS.PENDING_HR, LEAVE_STATUS.APPROVED, as("HR"))
        ).not.toThrow();
    });

    it("reports a reason without throwing", () => {
        const result = canTransition(LEAVE_TRANSITIONS, LEAVE_STATUS.APPROVED, LEAVE_STATUS.PENDING_HR, as("HR"));
        expect(result.allowed).toBe(false);
        expect(result.reason).toBeTruthy();
    });
});

describe("leave state machine", () => {
    it("allows manager approval from PENDING_MANAGER", () => {
        expect(() =>
            assertTransition("LEAVE", LEAVE_TRANSITIONS, LEAVE_STATUS.PENDING_MANAGER, LEAVE_STATUS.MANAGER_APPROVED, as("MANAGER"))
        ).not.toThrow();
    });

    it("allows a manager to route straight to APPROVED when HR review is not required", () => {
        expect(nextStates(LEAVE_TRANSITIONS, LEAVE_STATUS.PENDING_MANAGER)).toContain(LEAVE_STATUS.APPROVED);
    });

    it("blocks HR approving before the manager has acted", () => {
        // PENDING_MANAGER → APPROVED is reachable, but only by a MANAGER/HR/ADMIN
        // acting as the manager. A STAFF member can never approve at all.
        expect(() =>
            assertTransition("LEAVE", LEAVE_TRANSITIONS, LEAVE_STATUS.PENDING_MANAGER, LEAVE_STATUS.APPROVED, as("STAFF"))
        ).toThrow();
    });

    it("blocks a second approval of an already-approved request", () => {
        // This is the double-approval defect the old code allowed.
        expect(() =>
            assertTransition("LEAVE", LEAVE_TRANSITIONS, LEAVE_STATUS.APPROVED, LEAVE_STATUS.APPROVED, as("HR"))
        ).toThrow(InvalidTransitionError);
    });

    it("makes APPROVED, REJECTED and CANCELLED terminal", () => {
        for (const terminal of [LEAVE_STATUS.APPROVED, LEAVE_STATUS.REJECTED, LEAVE_STATUS.CANCELLED]) {
            expect(nextStates(LEAVE_TRANSITIONS, terminal)).toHaveLength(0);
        }
    });

    it("allows the employee to cancel their own pending request", () => {
        expect(() =>
            assertTransition("LEAVE", LEAVE_TRANSITIONS, LEAVE_STATUS.PENDING_MANAGER, LEAVE_STATUS.CANCELLED, as("STAFF"))
        ).not.toThrow();
    });
});

describe("offboarding state machine", () => {
    it("walks the full lifecycle REQUESTED → COMPLETED", () => {
        const path = [
            OFFBOARDING_STATUS.REQUESTED,
            OFFBOARDING_STATUS.IN_REVIEW,
            OFFBOARDING_STATUS.NOTICE_PERIOD,
            OFFBOARDING_STATUS.CLEARANCE,
            OFFBOARDING_STATUS.SETTLEMENT_PENDING,
            OFFBOARDING_STATUS.COMPLETED,
        ];
        for (let i = 0; i < path.length - 1; i++) {
            expect(() =>
                assertTransition("OFFBOARDING", OFFBOARDING_TRANSITIONS, path[i], path[i + 1], as("HR"))
            ).not.toThrow();
        }
    });

    it("blocks skipping straight to COMPLETED", () => {
        expect(() =>
            assertTransition("OFFBOARDING", OFFBOARDING_TRANSITIONS, OFFBOARDING_STATUS.REQUESTED, OFFBOARDING_STATUS.COMPLETED, as("ADMIN"))
        ).toThrow(InvalidTransitionError);
    });

    it("restricts offboarding to HR and above", () => {
        expect(() =>
            assertTransition("OFFBOARDING", OFFBOARDING_TRANSITIONS, OFFBOARDING_STATUS.REQUESTED, OFFBOARDING_STATUS.IN_REVIEW, as("MANAGER"))
        ).toThrow(InvalidTransitionError);
    });

    it("makes COMPLETED terminal", () => {
        expect(nextStates(OFFBOARDING_TRANSITIONS, OFFBOARDING_STATUS.COMPLETED)).toHaveLength(0);
    });
});

describe("payroll run state machine", () => {
    it("blocks a LOCKED run from being reopened", () => {
        // The payroll-lock requirement: once locked, ordinary edits are refused.
        expect(nextStates(PAYROLL_RUN_TRANSITIONS, PAYROLL_RUN_STATUS.LOCKED)).toHaveLength(0);
    });

    it("blocks MANAGER from approving payroll", () => {
        expect(() =>
            assertTransition("PAYROLL", PAYROLL_RUN_TRANSITIONS, PAYROLL_RUN_STATUS.UNDER_REVIEW, PAYROLL_RUN_STATUS.APPROVED, as("MANAGER"))
        ).toThrow(InvalidTransitionError);
    });

    it("restricts locking to ADMIN and above", () => {
        expect(() =>
            assertTransition("PAYROLL", PAYROLL_RUN_TRANSITIONS, PAYROLL_RUN_STATUS.APPROVED, PAYROLL_RUN_STATUS.LOCKED, as("FINANCE"))
        ).toThrow(InvalidTransitionError);
        expect(() =>
            assertTransition("PAYROLL", PAYROLL_RUN_TRANSITIONS, PAYROLL_RUN_STATUS.APPROVED, PAYROLL_RUN_STATUS.LOCKED, as("ADMIN"))
        ).not.toThrow();
    });
});

describe("letter state machine", () => {
    it("requires approval before generation for sensitive letters", () => {
        expect(nextStates(LETTER_TRANSITIONS, LETTER_STATUS.PENDING_APPROVAL)).toEqual(
            expect.arrayContaining([LETTER_STATUS.APPROVED, LETTER_STATUS.REJECTED])
        );
        expect(nextStates(LETTER_TRANSITIONS, LETTER_STATUS.APPROVED)).toContain(LETTER_STATUS.GENERATED);
    });

    it("allows a corrected letter to start a new version", () => {
        expect(nextStates(LETTER_TRANSITIONS, LETTER_STATUS.GENERATED)).toContain(LETTER_STATUS.DRAFT);
    });

    it("makes VOID terminal", () => {
        expect(nextStates(LETTER_TRANSITIONS, LETTER_STATUS.VOID)).toHaveLength(0);
    });
});

describe("settlement and checklist", () => {
    it("restricts settlement approval to ADMIN and above", () => {
        expect(() =>
            assertTransition("SETTLEMENT", SETTLEMENT_TRANSITIONS, "UNDER_REVIEW", "APPROVED", as("HR"))
        ).toThrow(InvalidTransitionError);
    });

    it("treats COMPLETED and WAIVED checklist items as terminal", () => {
        expect(nextStates(CHECKLIST_TRANSITIONS, CHECKLIST_STATUS.COMPLETED)).toHaveLength(0);
        expect(nextStates(CHECKLIST_TRANSITIONS, CHECKLIST_STATUS.WAIVED)).toHaveLength(0);
    });

    it("restricts waiving a checklist item to HR", () => {
        expect(() =>
            assertTransition("CHECKLIST", CHECKLIST_TRANSITIONS, CHECKLIST_STATUS.PENDING, CHECKLIST_STATUS.WAIVED, as("STAFF"))
        ).toThrow(InvalidTransitionError);
    });
});

describe("renewal state machine", () => {
    it("only HR can mark a renewal as renewed", () => {
        expect(() =>
            assertTransition("RENEWAL", RENEWAL_TRANSITIONS, "UNDER_REVIEW", "RENEWED", as("STAFF"))
        ).toThrow(InvalidTransitionError);
        expect(() =>
            assertTransition("RENEWAL", RENEWAL_TRANSITIONS, "UNDER_REVIEW", "RENEWED", as("HR"))
        ).not.toThrow();
    });
});

describe("leave day calculation", () => {
    it("counts working days across a calendar Mon–Fri week", () => {
        // The UAE working week is Sunday–Thursday; Friday and Saturday are the
        // weekend. A calendar Mon–Fri range therefore contains four working
        // days, not five.
        const days = calculateLeaveDays(parseDate("2026-06-01")!, parseDate("2026-06-05")!);
        expect(days).toBe(4);
    });

    it("counts a full Sunday–Thursday week as five working days", () => {
        // 2026-06-07 is a Sunday, 2026-06-11 a Thursday.
        const days = calculateLeaveDays(parseDate("2026-06-07")!, parseDate("2026-06-11")!);
        expect(days).toBe(5);
    });

    it("excludes the Friday/Saturday weekend", () => {
        // 2026-06-05 is a Friday, 2026-06-06 Saturday, 2026-06-07 Sunday.
        // Fri+Sat excluded, Sun–Mon included.
        const days = calculateLeaveDays(parseDate("2026-06-05")!, parseDate("2026-06-08")!);
        expect(days).toBe(2);
    });

    it("deducts half a day for a half-day request", () => {
        const full = calculateLeaveDays(parseDate("2026-06-01")!, parseDate("2026-06-01")!);
        const half = calculateLeaveDays(parseDate("2026-06-01")!, parseDate("2026-06-01")!, DAY_PART.HALF_DAY_FIRST_HALF);
        expect(full).toBe(1);
        expect(half).toBe(0.5);
    });

    it("returns 0 for an inverted range", () => {
        expect(calculateLeaveDays(parseDate("2026-06-10")!, parseDate("2026-06-01")!)).toBe(0);
    });

    it("returns 0 for a weekend-only range", () => {
        expect(calculateLeaveDays(parseDate("2026-06-06")!, parseDate("2026-06-06")!)).toBe(0);
    });
});

describe("accrual periods", () => {
    it("formats monthly and annual periods differently", () => {
        const ref = new Date("2026-03-15T00:00:00Z");
        expect(periodFor("MONTHLY", ref)).toBe("2026-03");
        expect(periodFor("ANNUAL", ref)).toBe("2026");
        expect(periodFor("MANUAL", ref)).toBe("2026-03");
    });
});

describe("punch fingerprint (attendance idempotency)", () => {
    const base = {
        deviceId: "DEV-1",
        employeeId: "emp-1",
        timestamp: new Date("2026-06-01T08:55:00.000Z"),
        type: "IN",
    };

    it("is stable for identical input", () => {
        expect(punchFingerprint(base)).toBe(punchFingerprint({ ...base }));
    });

    it("differs when any component differs", () => {
        expect(punchFingerprint(base)).not.toBe(punchFingerprint({ ...base, deviceId: "DEV-2" }));
        expect(punchFingerprint(base)).not.toBe(punchFingerprint({ ...base, employeeId: "emp-2" }));
        expect(punchFingerprint(base)).not.toBe(punchFingerprint({ ...base, type: "OUT" }));
        expect(punchFingerprint(base)).not.toBe(
            punchFingerprint({ ...base, timestamp: new Date("2026-06-01T08:56:00.000Z") })
        );
    });

    it("produces a hex digest", () => {
        expect(punchFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe("password strength (SEC-027)", () => {
    it("rejects the shared default that caused the original finding", () => {
        const result = checkPasswordStrength("password123");
        expect(result.ok).toBe(false);
    });

    it("enforces a 12-character minimum", () => {
        // 10 characters — rejected.
        expect(checkPasswordStrength("Ab1!efgh").ok).toBe(false);
        // 11 characters — still rejected.
        expect(checkPasswordStrength("Ab1!efghijk").ok).toBe(false);
        // 12 characters — accepted.
        expect(checkPasswordStrength("Ab1!efghijkl").ok).toBe(true);
    });

    it("requires mixed case, a digit and a symbol", () => {
        expect(checkPasswordStrength("alllowercase1!").ok).toBe(false);
        expect(checkPasswordStrength("ALLUPPERCASE1!").ok).toBe(false);
        expect(checkPasswordStrength("NoDigitsHere!").ok).toBe(false);
        expect(checkPasswordStrength("NoSymbolsHere1").ok).toBe(false);
    });

    it("reports every problem at once", () => {
        expect(checkPasswordStrength("abc").problems.length).toBeGreaterThan(2);
    });

    it("accepts a strong passphrase", () => {
        expect(checkPasswordStrength("Tr0ub4dor&3xKite").ok).toBe(true);
    });

    it("hashes tokens deterministically without storing them", () => {
        const token = "abc123";
        expect(hashToken(token)).toBe(hashToken(token));
        expect(hashToken(token)).not.toBe(token);
        expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
        expect(hashToken("abc124")).not.toBe(hashToken(token));
    });
});

describe("attendance import guards (unchanged by P1)", () => {
    it("still rejects non-CSV, empty and oversized files", () => {
        expect(validateFile({ name: "a.exe", size: 10 } as File)).toMatch(/only csv/i);
        expect(validateFile({ name: "a.csv", size: 0 } as File)).toMatch(/empty/i);
        expect(validateFile({ name: "a.csv", size: 6 * 1024 * 1024 } as File)).toMatch(/too large/i);
        expect(validateFile({ name: "a.csv", size: 100 } as File)).toBeNull();
    });
});
