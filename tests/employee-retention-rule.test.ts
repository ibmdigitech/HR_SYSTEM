/**
 * The retention rule itself — pure, no database, no Prisma, no mocks.
 *
 * `lib/employees/retention.ts` exists so that the period a record must be kept
 * lives in exactly one place. That is only worth anything if the arithmetic in
 * that place is pinned: the boundary has to be exact to the millisecond, because
 * "one millisecond early" on a retention rule is a compliance failure rather
 * than a rounding detail.
 *
 * The tests below are deliberately free of `vi.mock` so a reviewer can see that
 * nothing here reaches a database.
 */
import { describe, it, expect } from "vitest";
import {
    DEFAULT_EMPLOYEE_RETENTION_YEARS,
    EMPLOYEE_RETENTION_YEARS_ENV,
    MIN_EMPLOYEE_RETENTION_YEARS,
    NOT_ARCHIVED,
    RETENTION_POLICY_SOURCE,
    RetentionPolicyError,
    activeRetentionYears,
    archiveGuard,
    archiveWrite,
    isArchived,
    isRetentionElapsed,
    purgeEligibility,
    resolveRetentionYears,
    restoreWrite,
    retentionDeadline,
} from "@/lib/employees/retention";

const DAY = 24 * 60 * 60 * 1000;

/* ================================================================== */
/* The constant and where it comes from                                */
/* ================================================================== */

describe("the retention period is a named constant with a stated source", () => {
    it("is five years", () => {
        expect(DEFAULT_EMPLOYEE_RETENTION_YEARS).toBe(5);
    });

    it("names its provenance instead of being a bare literal", () => {
        // The audit trail pointed at this number. If the citation is removed the
        // figure becomes an unexplained magic number, and this fails.
        expect(RETENTION_POLICY_SOURCE).toContain("five years");
        expect(RETENTION_POLICY_SOURCE).toContain(EMPLOYEE_RETENTION_YEARS_ENV);
        expect(RETENTION_POLICY_SOURCE).toContain("6.5");
    });

    it("refuses a period below one year rather than allowing it", () => {
        expect(MIN_EMPLOYEE_RETENTION_YEARS).toBe(1);
        expect(() => retentionDeadline(new Date("2026-01-01T00:00:00Z"), 0)).toThrow(RetentionPolicyError);
        expect(() => retentionDeadline(new Date("2026-01-01T00:00:00Z"), -3)).toThrow(RetentionPolicyError);
        expect(() => retentionDeadline(new Date("2026-01-01T00:00:00Z"), 2.5)).toThrow(RetentionPolicyError);
    });
});

describe("resolveRetentionYears", () => {
    it("falls back to the documented default when unset, blank or nonsense", () => {
        expect(resolveRetentionYears({})).toBe(DEFAULT_EMPLOYEE_RETENTION_YEARS);
        expect(resolveRetentionYears({ [EMPLOYEE_RETENTION_YEARS_ENV]: "" })).toBe(5);
        expect(resolveRetentionYears({ [EMPLOYEE_RETENTION_YEARS_ENV]: "   " })).toBe(5);
        expect(resolveRetentionYears({ [EMPLOYEE_RETENTION_YEARS_ENV]: "seven" })).toBe(5);
        expect(resolveRetentionYears({ [EMPLOYEE_RETENTION_YEARS_ENV]: "7.5" })).toBe(5);
        expect(resolveRetentionYears({ [EMPLOYEE_RETENTION_YEARS_ENV]: "NaN" })).toBe(5);
    });

    it("accepts a jurisdiction or company override", () => {
        // A DIFC entity, or a company policy stricter than the legal floor.
        expect(resolveRetentionYears({ [EMPLOYEE_RETENTION_YEARS_ENV]: "10" })).toBe(10);
        expect(resolveRetentionYears({ [EMPLOYEE_RETENTION_YEARS_ENV]: " 8 " })).toBe(8);
    });

    it("throws on an override that would permit purging a record the moment it is archived", () => {
        // Silently clamping 0 to 1 would hide the fact that someone configured a
        // zero-year retention. Refusing makes the mistake visible.
        expect(() => resolveRetentionYears({ [EMPLOYEE_RETENTION_YEARS_ENV]: "0" })).toThrow(RetentionPolicyError);
        try {
            resolveRetentionYears({ [EMPLOYEE_RETENTION_YEARS_ENV]: "0" });
        } catch (error) {
            expect((error as RetentionPolicyError).code).toBe("RETENTION_TOO_SHORT");
            expect((error as Error).message).toContain(EMPLOYEE_RETENTION_YEARS_ENV);
        }
    });

    it("resolves the live process to the default when nothing is configured", () => {
        expect(activeRetentionYears()).toBe(resolveRetentionYears(process.env));
    });
});

/* ================================================================== */
/* The arithmetic                                                      */
/* ================================================================== */

describe("retentionDeadline", () => {
    it("adds whole calendar years, not 365-day blocks", () => {
        // 2020-01-01 + 5*365 days = 2024-12-31, one day early. Calendar
        // arithmetic lands on 2025-01-01 and does not drift.
        expect(retentionDeadline(new Date("2020-01-01T00:00:00Z")).toISOString()).toBe("2025-01-01T00:00:00.000Z");
        // 5 * 365 = 1825, but 2020-01-01 to 2025-01-01 spans the leap days of
        // 2020 and 2024, so 1827. A naive `+ 5*365 days` would purge two days
        // early.
        expect(retentionDeadline(new Date("2020-01-01T00:00:00Z")).getTime() - new Date("2020-01-01T00:00:00Z").getTime())
            .toBe(1827 * DAY);
    });

    it("keeps a 29 February anniversary one day LONGER rather than one day short", () => {
        // `setUTCFullYear` cannot land on 29 February in a non-leap year, so it
        // rolls to 1 March. That over-retains by a day, which is the safe
        // direction for a retention clock — an under-retaining implementation
        // would be the defect.
        expect(retentionDeadline(new Date("2024-02-29T00:00:00Z")).toISOString()).toBe("2029-03-01T00:00:00.000Z");
        expect(retentionDeadline(new Date("2025-02-29T00:00:00Z")).toISOString()).toBe("2030-03-01T00:00:00.000Z");
    });

    it("does not drift across a decade of leap days", () => {
        let cursor = new Date("2020-02-29T00:00:00.000Z");
        for (let i = 0; i < 10; i++) {
            const next = retentionDeadline(cursor, 1);
            expect(next.getUTCFullYear()).toBe(cursor.getUTCFullYear() + 1);
            // Never earlier than a naive 365-day addition would be.
            expect(next.getTime()).toBeGreaterThanOrEqual(cursor.getTime() + 365 * DAY);
            cursor = next;
        }
    });

    it("rejects an unusable clock", () => {
        expect(() => retentionDeadline(new Date("nonsense"))).toThrow(RetentionPolicyError);
        expect(() => retentionDeadline(new Date(NaN))).toThrow(RetentionPolicyError);
    });
});

describe("isRetentionElapsed — the boundary", () => {
    const clock = new Date("2020-01-15T10:00:00.000Z");
    const deadline = new Date("2025-01-15T10:00:00.000Z");

    it("is false one millisecond before the deadline", () => {
        expect(isRetentionElapsed(clock, new Date(deadline.getTime() - 1))).toBe(false);
    });

    it("is TRUE exactly on the deadline — inclusive, so it can never fire early", () => {
        // Deliberately opposite to lib/observability/retention.ts, which uses a
        // strict `<` so a log row is never deleted one millisecond early. Here
        // the dangerous direction is purging a young record, so `>=` is correct.
        expect(isRetentionElapsed(clock, deadline)).toBe(true);
    });

    it("is false one millisecond after an archive that has not aged", () => {
        const fresh = new Date("2026-09-30T12:00:00.000Z");
        expect(isRetentionElapsed(fresh, new Date("2026-09-30T12:00:00.001Z"))).toBe(false);
    });

    it("honours an override period", () => {
        expect(isRetentionElapsed(clock, new Date("2027-01-15T10:00:00.000Z"), 10)).toBe(false);
        expect(isRetentionElapsed(clock, new Date("2027-01-15T10:00:00.000Z"), 7)).toBe(true);
    });
});

/* ================================================================== */
/* Purge eligibility                                                   */
/* ================================================================== */

describe("purgeEligibility", () => {
    const now = new Date("2026-09-30T09:00:00.000Z");

    it("refuses a row that is not archived — purge is not a shortcut around archive", () => {
        const verdict = purgeEligibility({ deletedAt: null }, now);
        expect(verdict.eligible).toBe(false);
        expect(verdict.code).toBe("NOT_ARCHIVED");
        expect(verdict.purgeAfterIso).toBeNull();
        expect(verdict.reason).toMatch(/archive the record first/i);
    });

    it("refuses while retention has not elapsed, and names the date and the rule", () => {
        const verdict = purgeEligibility({ deletedAt: new Date("2024-01-01T00:00:00Z") }, now);
        expect(verdict.eligible).toBe(false);
        expect(verdict.code).toBe("RETENTION_NOT_ELAPSED");
        expect(verdict.purgeAfterIso).toBe("2029-01-01T00:00:00.000Z");
        expect(verdict.reason).toContain("2029-01-01T00:00:00.000Z");
        expect(verdict.reason).toContain("five years");
    });

    it("rounds the wait UP, so an operator is never told '0 days' while blocked", () => {
        // archivedAt + 5 years = 2026-09-30T09:01:00Z, and `now` is one minute
        // before it. So there is 60 seconds left to wait, and reporting that as
        // "0 days remaining" would tell an operator they may proceed.
        const verdict = purgeEligibility(
            { deletedAt: new Date("2021-09-30T09:01:00.000Z") },
            new Date("2026-09-30T09:00:00.000Z")
        );
        expect(verdict.eligible).toBe(false);
        expect(verdict.code).toBe("RETENTION_NOT_ELAPSED");
        expect(verdict.daysRemaining).toBe(1);
    });

    it("permits once the full period has passed", () => {
        const verdict = purgeEligibility({ deletedAt: new Date("2020-01-01T00:00:00Z") }, now);
        expect(verdict.eligible).toBe(true);
        expect(verdict.code).toBeNull();
        expect(verdict.reason).toBeNull();
        expect(verdict.daysRemaining).toBe(0);
        expect(verdict.purgeAfterIso).toBe("2025-01-01T00:00:00.000Z");
        expect(verdict.retentionYears).toBe(5);
    });

    it("permits exactly on the deadline", () => {
        const deadline = new Date("2025-01-01T00:00:00.000Z");
        expect(purgeEligibility({ deletedAt: new Date("2020-01-01T00:00:00Z") }, deadline).eligible).toBe(true);
        expect(
            purgeEligibility({ deletedAt: new Date("2020-01-01T00:00:00Z") }, new Date(deadline.getTime() - 1)).eligible
        ).toBe(false);
    });

    it("starts the clock at the end of the relationship when that is known", () => {
        // Archived in June, relationship ended in February. The obligation runs
        // from February, so the deadline is a month EARLIER than the archive-based
        // answer — using deletedAt would over-retain, using the true end date is
        // the correct reading of the law.
        const withEnd = purgeEligibility(
            {
                deletedAt: new Date("2021-06-01T00:00:00Z"),
                relationshipEndedAt: new Date("2021-02-01T00:00:00Z"),
            },
            now
        );
        expect(withEnd.purgeAfterIso).toBe("2026-02-01T00:00:00.000Z");
        expect(purgeEligibility({ deletedAt: new Date("2021-06-01T00:00:00Z") }, now).purgeAfterIso).toBe(
            "2026-06-01T00:00:00.000Z"
        );
    });

    it("refuses when the archive timestamp is in the future", () => {
        // Clock skew, or a bad write. Comparing a deadline derived from a future
        // instant against the present would be trivially satisfiable, and would
        // let a skewed clock purge a fresh record.
        const verdict = purgeEligibility({ deletedAt: new Date("2027-01-01T00:00:00Z") }, now);
        expect(verdict.eligible).toBe(false);
        expect(verdict.code).toBe("ARCHIVED_IN_FUTURE");
    });

    it("honours an override period", () => {
        const deletedAt = new Date("2021-01-01T00:00:00Z");
        expect(purgeEligibility({ deletedAt }, now, 10).eligible).toBe(false);
        expect(purgeEligibility({ deletedAt }, now, 10).code).toBe("RETENTION_NOT_ELAPSED");
        expect(purgeEligibility({ deletedAt }, now, 5).eligible).toBe(true);
    });
});

/* ================================================================== */
/* The write shapes                                                    */
/* ================================================================== */

describe("archiveWrite — ONE guarded write sets both columns", () => {
    const now = new Date("2026-09-30T09:00:00.000Z");

    it("sets deletedAt and isActive together, in a single data object", () => {
        const data = archiveWrite(now);
        // Two keys, one object. If a future change splits this into two
        // statements there is a window where the row is archived but still
        // flagged active, and every `isActive: true` listing keeps serving it.
        expect(Object.keys(data).sort()).toEqual(["deletedAt", "isActive"]);
        expect(data.deletedAt).toEqual(now);
        expect(data.isActive).toBe(false);
    });

    it("rejects an unusable clock rather than writing a null tombstone", () => {
        expect(() => archiveWrite(new Date("nope"))).toThrow(RetentionPolicyError);
    });
});

describe("archiveGuard — idempotency lives in the where clause, not in a pre-read", () => {
    it("matches only a row that exists and is not already archived", () => {
        expect(archiveGuard("emp-1")).toEqual({ id: "emp-1", deletedAt: null });
    });

    it("returns a fresh object so one caller cannot poison another's guard", () => {
        expect(archiveGuard("emp-1")).not.toBe(archiveGuard("emp-1"));
    });
});

describe("restoreWrite", () => {
    it("clears the tombstone and reinstates isActive, so restore is not a rename", () => {
        expect(restoreWrite(true)).toEqual({ deletedAt: null, isActive: true });
    });

    it("takes the reactivation decision from the caller, because archive is not the only thing that sets isActive false", () => {
        // A row archived AFTER a terminal exit was archived as a departure.
        // Reinstating isActive there would return a departed employee to
        // headcount and payroll, so the write obeys the caller.
        expect(restoreWrite(false)).toEqual({ deletedAt: null, isActive: false });
    });
});

describe("NOT_ARCHIVED", () => {
    it("is the single tombstone predicate every listing should carry", () => {
        expect(NOT_ARCHIVED).toEqual({ deletedAt: null });
    });

    it("is frozen, so a caller cannot mutate the shared literal", () => {
        expect(Object.isFrozen(NOT_ARCHIVED)).toBe(true);
    });

    it("composes into an existing where clause without clobbering it", () => {
        expect({ isActive: true, ...NOT_ARCHIVED }).toEqual({ isActive: true, deletedAt: null });
        expect({ department: "Operations", ...NOT_ARCHIVED }).toEqual({ department: "Operations", deletedAt: null });
    });
});

describe("isArchived", () => {
    it("treats only a real timestamp as archived", () => {
        expect(isArchived({ deletedAt: new Date() })).toBe(true);
        expect(isArchived({ deletedAt: null })).toBe(false);
        expect(isArchived({ deletedAt: undefined })).toBe(false);
        expect(isArchived({})).toBe(false);
        expect(isArchived(null)).toBe(false);
    });
});

describe("the whole rule, end to end on one real calendar", () => {
    it("refuses a fresh archive and permits it five years later", () => {
        const archivedAt = new Date("2026-09-30T09:00:00.000Z");

        const oneMinuteLater = purgeEligibility({ deletedAt: archivedAt }, new Date(archivedAt.getTime() + 60_000));
        expect(oneMinuteLater.eligible).toBe(false);

        const oneDayShort = purgeEligibility(
            { deletedAt: archivedAt },
            new Date(archivedAt.getTime() + 5 * 365 * DAY - DAY)
        );
        expect(oneDayShort.eligible).toBe(false);

        const justAfter = purgeEligibility(
            { deletedAt: archivedAt },
            new Date(retentionDeadline(archivedAt).getTime() + 1)
        );
        expect(justAfter.eligible).toBe(true);
    });
});
