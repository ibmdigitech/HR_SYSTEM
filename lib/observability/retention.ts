/**
 * Audit log retention arithmetic.
 *
 * WHY A TypeScript MODULE FOR A PowerShell SCRIPT'S LOGIC
 * ------------------------------------------------------
 * `scripts/prune-audit-log.ps1` has to delete rows from `SecurityAuditLog`
 * without touching `prisma/schema.prisma` (another agent owns that file, and a
 * destructive script should not depend on a codegen step to be correct). So the
 * script computes its cutoff with `Get-Date`, and this module computes it with
 * `Date`.
 *
 * Two implementations of one rule is one rule too many, so the rule is stated
 * here, once, and pinned by `tests/observability-retention.test.ts`. The script
 * is required to match: same default, same boundary, same future-cutoff refusal.
 * If you change one, change both, and the tests will tell you which you missed.
 *
 * THE BOUNDARY, PRECISELY
 * -----------------------
 * A row is expired if and only if:
 *
 *     createdAt < cutoff            (STRICTLY less than)
 *
 * where `cutoff = now - retentionDays`. A row whose `createdAt` is EXACTLY the
 * cutoff is KEPT. `<` rather than `<=` is deliberate:
 *
 *   - `<=` makes the rule depend on whether the caller's `now` happens to land
 *     on a millisecond of data. A row written in the same millisecond as a run
 *     would be deleted by one run and kept by the next, which is a bug an
 *     operator cannot reproduce.
 *   - `<` gives a stable answer for a stable input, which is what a retention
 *     policy has to be. "Rows older than 400 days" means older, not "400 days
 *     old or more".
 *
 * The SQL in the script uses `<` to match, and the dry run reports the count
 * that the subsequent DELETE would remove - so the number a dry run prints is
 * the number a real run removes, and they cannot drift.
 *
 * ZERO, NOT A MILLISECOND, IS THE FLOOR
 * -------------------------------------
 * `now` is truncated to whole seconds before the subtraction. A cutoff that
 * carried a millisecond component would put a row written 399.99 days ago on
 * the wrong side of the boundary depending on when in the second the job fired.
 */

/**
 * One year.
 *
 * Not a compliance figure - this system has no regulatory retention mandate
 * documented in `docs/audit/`. It is a conservative default that cannot delete
 * a full year of security history on first run, which is the property that
 * matters for a script whose whole job is to destroy data.
 */
export const DEFAULT_RETENTION_DAYS = 365;

/** Below this, the script refuses. A one-day window is a typo, not a policy. */
export const MIN_RETENTION_DAYS = 1;

/**
 * Above this fraction of the table, a destructive run refuses without
 * `AllowMassDelete`. A script that can delete 100% of an append-only security
 * log should be very uncomfortable about it, and "the window happened to be
 * short" is exactly the kind of mistake that is discovered afterwards.
 */
export const MAX_SAFE_DELETE_FRACTION = 0.95;

export interface RetentionPlan {
    /** ISO-8601 UTC, second precision. Directly usable as the SQL bound. */
    cutoffIso: string;
    retentionDays: number;
    /** ISO-8601 UTC, second precision. */
    nowIso: string;
}

function toSecondPrecision(date: Date): Date {
    return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

export class RetentionPlanError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
        super(message);
        this.name = "RetentionPlanError";
        this.code = code;
    }
}

/**
 * Computes the cutoff. Throws `RetentionPlanError` rather than producing a
 * nonsensical plan, because a cutoff in the future deletes nothing now and
 * EVERYTHING later - the single worst outcome available to this script.
 */
export function computeRetentionPlan(now: Date, retentionDays: number = DEFAULT_RETENTION_DAYS): RetentionPlan {
    if (!Number.isFinite(now.getTime())) {
        throw new RetentionPlanError("INVALID_NOW", "now is not a valid Date");
    }
    if (!Number.isInteger(retentionDays)) {
        throw new RetentionPlanError("INVALID_RETENTION", "retentionDays must be a whole number of days");
    }
    if (retentionDays < MIN_RETENTION_DAYS) {
        throw new RetentionPlanError(
            "RETENTION_TOO_SHORT",
            `retentionDays must be at least ${MIN_RETENTION_DAYS}; ${retentionDays} would delete a security log that is one day old`
        );
    }

    const nowWhole = toSecondPrecision(now);
    const cutoff = new Date(nowWhole.getTime() - retentionDays * 24 * 60 * 60 * 1000);

    if (cutoff.getTime() >= nowWhole.getTime()) {
        throw new RetentionPlanError("CUTOFF_NOT_PAST", "computed cutoff is not in the past; refusing to plan a delete")
    }

    return {
        cutoffIso: cutoff.toISOString(),
        retentionDays,
        nowIso: nowWhole.toISOString(),
    };
}

/**
 * The predicate the SQL expresses. STRICTLY less than; see the module header.
 *
 * Exists so the boundary is unit-testable without a database, and so the
 * documented rule has exactly one executable definition.
 */
export function isExpired(createdAt: Date, cutoff: Date): boolean {
    if (!Number.isFinite(createdAt.getTime()) || !Number.isFinite(cutoff.getTime())) return false;
    return createdAt.getTime() < cutoff.getTime();
}

/** Row counts a dry run reports, and the mass-delete guard's inputs. */
export interface RetentionStats {
    total: number;
    expired: number;
    oldestIso: string | null;
    newestIso: string | null;
    oldestExpiredIso: string | null;
    newestExpiredIso: string | null;
}

export interface MassDeleteVerdict {
    allowed: boolean;
    fraction: number;
    reason: string | null;
}

/**
 * Decides whether a destructive run may proceed. A dry run is never blocked:
 * counting rows destroys nothing.
 */
export function checkMassDelete(stats: RetentionStats, allowMassDelete: boolean): MassDeleteVerdict {
    const fraction = stats.total === 0 ? 0 : stats.expired / stats.total;
    if (allowMassDelete) return { allowed: true, fraction, reason: null };
    if (stats.total === 0) {
        return { allowed: true, fraction: 0, reason: null };
    }
    if (fraction > MAX_SAFE_DELETE_FRACTION) {
        return {
            allowed: false,
            fraction,
            reason:
                `a ${(fraction * 100).toFixed(1)}% delete (${stats.expired} of ${stats.total} rows) exceeds the ` +
                `${(MAX_SAFE_DELETE_FRACTION * 100).toFixed(0)}% safety limit. Confirm the window is intended, ` +
                "then re-run with AllowMassDelete.",
        };
    }
    return { allowed: true, fraction, reason: null };
}
