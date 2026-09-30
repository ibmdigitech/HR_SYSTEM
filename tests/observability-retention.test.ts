/**
 * Audit log retention tests (PRODUCTION_READINESS_CHECKLIST 9.6).
 *
 * The rule under test is the one that decides what an append-only security log
 * loses, so it is pinned precisely rather than approximately.
 *
 * `scripts/prune-audit-log.ps1` is a DESTRUCTIVE script and is never executed
 * here - running it to test it is how audit logs get deleted. Its contract is
 * pinned by reading the file instead, which is cheap, safe, and catches the
 * regressions that matter: someone "tidying" the default to delete on first
 * run, or switching `<` to `<=`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
    computeRetentionPlan,
    isExpired,
    checkMassDelete,
    RetentionPlanError,
    DEFAULT_RETENTION_DAYS,
    MIN_RETENTION_DAYS,
    MAX_SAFE_DELETE_FRACTION,
} from "@/lib/observability/retention";

const NOW = new Date("2026-09-29T12:00:00.000Z");

/* ------------------------------------------------------------------ */
/* The window                                                          */
/* ------------------------------------------------------------------ */

describe("retention window", () => {
    it("defaults to one year", () => {
        expect(DEFAULT_RETENTION_DAYS).toBe(365);
        expect(computeRetentionPlan(NOW).retentionDays).toBe(365);
    });

    it("puts the cutoff exactly retentionDays before now", () => {
        const plan = computeRetentionPlan(NOW, 90);
        expect(plan.cutoffIso).toBe("2026-07-01T12:00:00.000Z");
        expect(Date.parse(plan.nowIso) - Date.parse(plan.cutoffIso)).toBe(90 * 24 * 60 * 60 * 1000);
    });

    it("is measured in whole 24-hour days, not calendar months", () => {
        // A month-based window makes the answer depend on which month the job
        // happens to run in, which is not a property a retention policy should
        // have.
        const plan = computeRetentionPlan(NOW, 30);
        expect(plan.cutoffIso).toBe("2026-08-30T12:00:00.000Z");
    });

    it("truncates now to whole seconds, so a row in the same second is stable", () => {
        const plan = computeRetentionPlan(new Date("2026-09-29T12:00:00.987Z"), 10);
        expect(plan.nowIso).toBe("2026-09-29T12:00:00.000Z");
        expect(plan.cutoffIso).toBe("2026-09-19T12:00:00.000Z");
    });

    it("is a pure function of (now, days): the same input gives the same plan", () => {
        expect(computeRetentionPlan(NOW, 400)).toEqual(computeRetentionPlan(NOW, 400));
    });
});

describe("retention window guards", () => {
    it("refuses a window shorter than the minimum", () => {
        expect(() => computeRetentionPlan(NOW, 0)).toThrow(RetentionPlanError);
        expect(() => computeRetentionPlan(NOW, -1)).toThrow(/at least 1/);
        try {
            computeRetentionPlan(NOW, 0);
        } catch (e) {
            expect((e as RetentionPlanError).code).toBe("RETENTION_TOO_SHORT");
        }
    });

    it("refuses a fractional window rather than rounding it silently", () => {
        // Silently flooring 1.9 to 1, or keeping 1.9 and deleting a day and a
        // half, are both worse than refusing.
        expect(() => computeRetentionPlan(NOW, 1.5)).toThrow(/whole number/);
        expect(MIN_RETENTION_DAYS).toBe(1);
    });

    it("refuses an invalid date", () => {
        expect(() => computeRetentionPlan(new Date("not a date"), 30)).toThrow(/not a valid Date/);
    });
});

/* ------------------------------------------------------------------ */
/* The boundary - THIS is the part that deletes rows                  */
/* ------------------------------------------------------------------ */

describe("cutoff boundary is EXCLUSIVE, as documented", () => {
    const cutoff = new Date(computeRetentionPlan(NOW, 30).cutoffIso);

    it("deletes a row one millisecond before the cutoff", () => {
        expect(isExpired(new Date(cutoff.getTime() - 1), cutoff)).toBe(true);
    });

    it("KEEPS a row exactly at the cutoff - `<`, not `<=`", () => {
        // This is the assertion the module header is about. If someone changes
        // `<` to `<=` in the SQL, this test is the thing that should fail.
        expect(isExpired(new Date(cutoff.getTime()), cutoff)).toBe(false);
    });

    it("KEEPS a row one millisecond after the cutoff", () => {
        expect(isExpired(new Date(cutoff.getTime() + 1), cutoff)).toBe(false);
    });

    it("gives the same answer for the same input every time", () => {
        // The reason `<=` was rejected: a run landing in the same millisecond as
        // a write would give a different answer than a run landing a
        // millisecond later, for the same data.
        const row = new Date(cutoff.getTime());
        const results = Array.from({ length: 50 }, () => isExpired(row, cutoff));
        expect(new Set(results).size).toBe(1);
    });

    it("treats an invalid date as not expired rather than deleting it", () => {
        // A NULL or unparseable timestamp must never be read as "older than the
        // cutoff" and removed.
        expect(isExpired(new Date("nonsense"), cutoff)).toBe(false);
    });

    it("matches the SQL the script builds: <, never <=", () => {
        const source = readFileSync(
            fileURLToPath(new URL("../scripts/prune-audit-log.ps1", import.meta.url)),
            "latin1"
        );
        // The predicate is assembled as `$qColumn + ' < ' + $cutoffLiteral`.
        expect(source).toContain("$qColumn + ' < ' + $cutoffLiteral");
        // A `<=` in the EXECUTABLE portion would silently widen the delete by
        // however many rows land exactly on the cutoff. The comment header is
        // stripped first: prose is allowed to mention the operator it is
        // warning about, code is not.
        const code = source.replace(/^[\s\S]*?#>\r?\n/, "");
        expect(code).not.toContain("<=");
    });
});

/* ------------------------------------------------------------------ */
/* Mass-delete guard                                                   */
/* ------------------------------------------------------------------ */

describe("mass delete guard", () => {
    const stats = (total: number, expired: number) => ({
        total,
        expired,
        oldestIso: null,
        newestIso: null,
        oldestExpiredIso: null,
        newestExpiredIso: null,
    });

    it("allows a run that removes a small share", () => {
        const v = checkMassDelete(stats(1000, 10), false);
        expect(v.allowed).toBe(true);
        expect(v.fraction).toBeCloseTo(0.01);
    });

    it("allows a run that removes exactly the limit", () => {
        expect(checkMassDelete(stats(100, 95), false).allowed).toBe(true);
    });

    it("refuses a run that removes more than the limit", () => {
        const v = checkMassDelete(stats(100, 96), false);
        expect(v.allowed).toBe(false);
        expect(v.reason).toContain("AllowMassDelete");
    });

    it("refuses to remove the whole table", () => {
        expect(checkMassDelete(stats(50, 50), false).allowed).toBe(false);
        expect(MAX_SAFE_DELETE_FRACTION).toBe(0.95);
    });

    it("is overridden explicitly, and then allowed", () => {
        expect(checkMassDelete(stats(50, 50), true).allowed).toBe(true);
    });

    it("allows an empty table", () => {
        expect(checkMassDelete(stats(0, 0), false).allowed).toBe(true);
    });

    it("does not divide by zero when the table is empty", () => {
        expect(checkMassDelete(stats(0, 0), false).fraction).toBe(0);
    });
});

/* ------------------------------------------------------------------ */
/* The script's own contract                                           */
/* ------------------------------------------------------------------ */

describe("scripts/prune-audit-log.ps1 contract", () => {
    const source = readFileSync(
        fileURLToPath(new URL("../scripts/prune-audit-log.ps1", import.meta.url)),
        "latin1"
    );

    it("is pure ASCII, because Windows PowerShell 5.1 decodes a BOM-less file as ANSI", () => {
        const bytes = readFileSync(
            fileURLToPath(new URL("../scripts/prune-audit-log.ps1", import.meta.url))
        );
        for (let i = 0; i < bytes.length; i++) {
            expect(bytes[i]).toBeLessThanOrEqual(127);
        }
    });

    it("defaults to the same window as DEFAULT_RETENTION_DAYS", () => {
        expect(source).toContain(`[int] $RetentionDays = ${DEFAULT_RETENTION_DAYS}`);
    });

    it("gates the destructive path behind an explicit switch", () => {
        expect(source).toContain("[switch] $Execute");
        // The dry-run exit must come BEFORE the first DELETE.
        const dryRunExit = source.indexOf("DRY RUN:");
        const deleteStatement = source.indexOf("DELETE FROM");
        expect(dryRunExit).toBeGreaterThan(-1);
        expect(deleteStatement).toBeGreaterThan(dryRunExit);
    });

    it("verifies the table and column against the live schema before any DELETE", () => {
        const tableCheck = source.indexOf("information_schema.tables");
        const columnCheck = source.indexOf("information_schema.columns");
        const deleteStatement = source.indexOf("DELETE FROM");
        expect(tableCheck).toBeGreaterThan(-1);
        expect(columnCheck).toBeGreaterThan(tableCheck);
        expect(deleteStatement).toBeGreaterThan(columnCheck);
    });

    it("refuses to run against a future cutoff", () => {
        expect(source).toContain("is not in the past");
    });

    it("uses ON_ERROR_STOP so a failed DELETE cannot exit 0", () => {
        expect(source).toContain("'ON_ERROR_STOP=1'");
    });

    it("rejects a malformed identifier before building SQL from it", () => {
        expect(source).toContain("'^[A-Za-z_][A-Za-z0-9_]*$'");
    });

    it("exits non-zero on failure", () => {
        expect(source).toContain("exit 1");
        expect(source).toContain("Write-Fail");
    });

    it("prints what it did, in both modes", () => {
        expect(source).toContain("retention report");
        expect(source).toContain("DRY RUN:");
        expect(source).toContain("deleted {0} row(s)");
    });
});

/* ------------------------------------------------------------------ */
/* Health check script contract                                        */
/* ------------------------------------------------------------------ */

describe("scripts/healthcheck.ps1 contract", () => {
    const source = readFileSync(
        fileURLToPath(new URL("../scripts/healthcheck.ps1", import.meta.url)),
        "latin1"
    );

    it("is pure ASCII", () => {
        const bytes = readFileSync(
            fileURLToPath(new URL("../scripts/healthcheck.ps1", import.meta.url))
        );
        for (let i = 0; i < bytes.length; i++) {
            expect(bytes[i]).toBeLessThanOrEqual(127);
        }
    });

    it("separates 'app down' from 'database down' using the database field", () => {
        // The distinction the whole script exists for. If the 503 branch stops
        // reading `database`, the monitor silently degrades into a one-bit
        // signal and this fails.
        expect(source).toContain("$STATE_DATABASE_DOWN");
        expect(source).toContain("'database'");
        expect(source).toContain("result={0} http={1}");
    });

    it("exits non-zero when unhealthy and zero when healthy", () => {
        expect(source).toContain("exit 0");
        expect(source).toContain("exit 1");
    });

    it("retries rather than reporting a single dropped packet as an outage", () => {
        expect(source).toContain("[int] $Retries = 3");
        expect(source).toContain("Start-Sleep -Seconds $RetryDelaySeconds");
    });

    it("treats a 401/403 as a configuration fault, not an outage", () => {
        expect(source).toContain("$STATE_PROBE_NOT_PUBLIC");
        expect(source).toContain("isPublicPath()");
    });

    it("enables TLS 1.2, which .NET Framework does not enable by default", () => {
        // Without this, every HTTPS probe fails and looks like an outage.
        expect(source).toContain("SecurityProtocolType]::Tls12");
    });
});
