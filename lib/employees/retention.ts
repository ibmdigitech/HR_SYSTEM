/**
 * Employee record retention — the ONE place the rule is stated.
 *
 * WHY A MODULE RATHER THAN A CONSTANT INLINE IN THE ACTION
 * -------------------------------------------------------
 * `app/lib/actions/employees.ts` performs the archive and the purge. It must not
 * also decide *how long a record must be kept*, because a retention figure that
 * lives next to the code that destroys data is a figure nobody reviews. This
 * module owns the arithmetic, the boundary, and the refusal, and it is pure: no
 * database, no Prisma client, no `Date.now()` hidden inside a predicate. Every
 * function takes the clock as an argument so the boundary is testable to the
 * millisecond rather than approximately.
 *
 * THE ASSUMPTION, AND WHERE IT COMES FROM
 * --------------------------------------
 * `DEFAULT_EMPLOYEE_RETENTION_YEARS = 5`.
 *
 * Provenance: UAE labour law requires an employer to retain an employee's file
 * for five years after the employment relationship ends. That figure is the
 * reason this module exists at all — `docs/audit/PRODUCTION_READINESS_CHECKLIST.md`
 * records it as blocker 6.5 ("Soft delete / retention", `❌ BLOCKER`) and
 * `docs/audit/EXECUTIVE_SUMMARY.md:44` restates it as "Employee data can be
 * permanently deleted / UAE law requires 5-year retention".
 *
 * IT IS A DEFAULT, NOT A LEGAL OPINION, AND A HUMAN MUST CONFIRM IT:
 *   - The five-year clock here starts at `deletedAt` (the archive date), NOT at
 *     the last working day. Those differ whenever an archived record is later
 *     re-activated or the relationship ends before HR archives it. Starting the
 *     clock at the *end of the relationship* is the stricter and more defensible
 *     reading of the law, and is why `retentionDeadline` accepts an explicit
 *     `relationshipEndedAt` — see `purgeEligibility` below.
 *   - Wages records in the UAE are additionally subject to Ministry of Labour
 *     record-keeping expectations that can exceed five years, and a DIFC/ADGM
 *     free-zone entity may be governed by a different regime than mainland
 *     Federal law. None of that is encoded here.
 *   - `HR_EMPLOYEE_RETENTION_YEARS` overrides the default per deployment, so a
 *     jurisdiction or company policy can be set without a code change.
 *
 * NO OTHER MODEL GETS A `deletedAt`
 * ---------------------------------
 * Verified against `pg_constraint` on the live database rather than assumed:
 *
 *   AuditLog_employeeId_fkey         ON DELETE RESTRICT
 *   LeaveRequest_employeeId_fkey     ON DELETE RESTRICT
 *   Letter_employeeId_fkey           ON DELETE SET NULL
 *   Notification_employeeId_fkey     ON DELETE NO ACTION
 *   Attachment_employeeId_fkey       ON DELETE CASCADE
 *   OnboardingChecklistItem_...fkey  ON DELETE CASCADE
 *
 * `AuditLog` needs no tombstone because an audit trail is never deleted — it IS
 * the artefact the retention rule exists to protect. `Letter` already has
 * `voidedAt`/`voidReason`, which is the correct soft-removal for an issued
 * document. Nothing else in the schema holds personally identifiable employee
 * data with a delete verb exposed to a user.
 */

/* ------------------------------------------------------------------ */
/* The named, overridable policy constant                               */
/* ------------------------------------------------------------------ */

/**
 * Years an archived employee record must be retained before a purge is allowed.
 *
 * See the module header for provenance. Override per deployment with
 * `HR_EMPLOYEE_RETENTION_YEARS`; there is no second place to change it.
 */
export const DEFAULT_EMPLOYEE_RETENTION_YEARS = 5;

/** Env var a deployment sets to override the default. Documented, not guessed. */
export const EMPLOYEE_RETENTION_YEARS_ENV = "HR_EMPLOYEE_RETENTION_YEARS";

/**
 * Below this, a configured value is treated as a typo rather than a policy.
 * A zero-year retention would let `purgeEmployee` destroy a record the instant
 * it was archived, which is the exact failure this module exists to prevent.
 */
export const MIN_EMPLOYEE_RETENTION_YEARS = 1;

/** Human-readable provenance, surfaced in the purge refusal message. */
export const RETENTION_POLICY_SOURCE =
    "UAE employment record retention, five years after the employment relationship ends " +
    "(docs/audit/PRODUCTION_READINESS_CHECKLIST.md blocker 6.5). " +
    `Override per deployment with ${EMPLOYEE_RETENTION_YEARS_ENV}.`;

export class RetentionPolicyError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
        super(message);
        this.name = "RetentionPolicyError";
        this.code = code;
    }
}

/**
 * Resolves the retention period from configuration.
 *
 * Pure: takes the environment bag as an argument rather than reading
 * `process.env` inline, so a test can prove the parsing without mutating global
 * state and without the answer depending on what else has run first.
 *
 * Falls back to the documented default on absent, blank or unparseable input
 * rather than throwing: a typo in a deployment variable must not take the whole
 * HR system down, and the default is the safe (longer) direction.
 */
export function resolveRetentionYears(env: Record<string, string | undefined> = {}): number {
    const raw = env[EMPLOYEE_RETENTION_YEARS_ENV];
    if (raw === undefined || raw === null) return DEFAULT_EMPLOYEE_RETENTION_YEARS;

    const trimmed = String(raw).trim();
    if (trimmed === "") return DEFAULT_EMPLOYEE_RETENTION_YEARS;

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        return DEFAULT_EMPLOYEE_RETENTION_YEARS;
    }
    if (parsed < MIN_EMPLOYEE_RETENTION_YEARS) {
        // Refuse rather than silently clamp: a configured 0 is a decision that
        // must be visible to whoever made it, not a value quietly rewritten.
        throw new RetentionPolicyError(
            "RETENTION_TOO_SHORT",
            `${EMPLOYEE_RETENTION_YEARS_ENV}=${trimmed} would permit purging an employee record the ` +
                `moment it is archived. The minimum is ${MIN_EMPLOYEE_RETENTION_YEARS} year(s).`
        );
    }
    return parsed;
}

/** The period this process is actually running with. */
export function activeRetentionYears(): number {
    return resolveRetentionYears(process.env);
}

/* ------------------------------------------------------------------ */
/* The arithmetic                                                      */
/* ------------------------------------------------------------------ */

/**
 * The instant at which an archived record first becomes purge-eligible.
 *
 * `clock` is the moment the employment relationship ENDED, not the moment the
 * row was archived. They differ — an employee can be marked RESIGNED in
 * February and archived in June — and the retention obligation runs from the end
 * of the relationship. Callers that only have `deletedAt` should pass that,
 * which yields the conservative answer (the clock starts later).
 */
export function retentionDeadline(
    clock: Date,
    years: number = DEFAULT_EMPLOYEE_RETENTION_YEARS
): Date {
    assertUsableDate(clock, "clock");
    assertRetentionYears(years);

    // Whole-year arithmetic on the calendar, not 365-day multiplication: adding
    // 5*365 days drifts by up to five leap days and can land a day early, which
    // for a retention rule is a compliance error rather than a rounding detail.
    //
    // ONE EDGE CASE, AND IT FAILS SAFE. When the anniversary is 29 February,
    // `setUTCFullYear` on a non-leap target year rolls forward to 1 March rather
    // than clamping to 28 February — so a record archived on a leap day is
    // retained up to one day LONGER than the nominal period. Over-retaining is
    // the correct direction for a retention clock; under-retaining is not, so
    // no clamping is applied. Pinned by
    // `tests/employee-retention-rule.test.ts`.
    const deadline = new Date(clock.getTime());
    deadline.setUTCFullYear(deadline.getUTCFullYear() + years);
    return deadline;
}

function assertUsableDate(value: unknown, label: string): asserts value is Date {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
        throw new RetentionPolicyError("INVALID_DATE", `${label} is not a valid Date`);
    }
}

function assertRetentionYears(years: number): void {
    if (!Number.isInteger(years) || years < MIN_EMPLOYEE_RETENTION_YEARS) {
        throw new RetentionPolicyError(
            "RETENTION_TOO_SHORT",
            `retentionYears must be a whole number of years >= ${MIN_EMPLOYEE_RETENTION_YEARS}; got ${years}`
        );
    }
}

/**
 * The boundary, precisely.
 *
 * Retention has elapsed if and only if `now >= deadline`. INCLUSIVE, unlike
 * `lib/observability/retention.ts` which uses a strict `<` for *expiry* of a
 * row that is about to be destroyed. The two are deliberately opposite:
 *
 *   - observability retention: `createdAt < cutoff` means "strictly older than",
 *     so a run does not delete a row that lands on the cut-off millisecond and
 *     keep it on the next run. The dangerous direction there is deleting a
 *     young row.
 *   - employee retention: `now >= deadline` means "the full period has passed",
 *     so a purge cannot fire a millisecond early. The dangerous direction here
 *     is purging a young record.
 *
 * A record becomes eligible exactly ON the deadline and never before, which is
 * the property an auditor checks.
 */
export function isRetentionElapsed(
    clock: Date,
    now: Date,
    years: number = DEFAULT_EMPLOYEE_RETENTION_YEARS
): boolean {
    return now.getTime() >= retentionDeadline(clock, years).getTime();
}

/* ------------------------------------------------------------------ */
/* Purge eligibility                                                    */
/* ------------------------------------------------------------------ */

export interface PurgeCandidate {
    /** NULL means the row is not archived, so it is not a purge candidate at all. */
    deletedAt: Date | null;
    /**
     * The end of the employment relationship when it is known. `deletedAt` is
     * used when this is absent, which starts the clock later and is therefore
     * the conservative choice.
     */
    relationshipEndedAt?: Date | null;
}

export interface PurgeEligibility {
    eligible: boolean;
    /** ISO-8601. Present whenever a clock could be established. */
    purgeAfterIso: string | null;
    retentionYears: number;
    /** Stable machine-readable code. `null` when eligible. */
    code:
        | "NOT_ARCHIVED"
        | "RETENTION_NOT_ELAPSED"
        | "ARCHIVED_IN_FUTURE"
        | null;
    reason: string | null;
    /** Days remaining, rounded up. `0` when eligible. */
    daysRemaining: number;
}

/**
 * Decides whether a record MAY be destroyed. Pure: no clock read, no database.
 *
 * Three refusals, in order, each of which is a distinct operational mistake:
 *
 *   NOT_ARCHIVED            — someone reached for purge on a live employee. The
 *                             archive action exists; purge is not a shortcut
 *                             around it.
 *   ARCHIVED_IN_FUTURE      — `deletedAt` is ahead of `now`. Clock skew or a
 *                             bad write. Refusing is correct: computing a
 *                             deadline from a future instant and comparing it to
 *                             a present one would be trivially satisfiable and
 *                             would let a skewed clock purge a fresh record.
 *   RETENTION_NOT_ELAPSED   — the ordinary case.
 */
export function purgeEligibility(
    candidate: PurgeCandidate,
    now: Date,
    years: number = DEFAULT_EMPLOYEE_RETENTION_YEARS
): PurgeEligibility {
    assertUsableDate(now, "now");
    assertRetentionYears(years);

    if (candidate.deletedAt === null || candidate.deletedAt === undefined) {
        return {
            eligible: false,
            purgeAfterIso: null,
            retentionYears: years,
            code: "NOT_ARCHIVED",
            reason: "This employee is not archived. Archive the record first; purge is not a shortcut around archive.",
            daysRemaining: 0,
        };
    }

    assertUsableDate(candidate.deletedAt, "deletedAt");

    const clock =
        candidate.relationshipEndedAt instanceof Date && Number.isFinite(candidate.relationshipEndedAt.getTime())
            ? candidate.relationshipEndedAt
            : candidate.deletedAt;

    if (clock.getTime() > now.getTime()) {
        return {
            eligible: false,
            purgeAfterIso: null,
            retentionYears: years,
            code: "ARCHIVED_IN_FUTURE",
            reason:
                "The retention clock starts in the future, which means the archive timestamp or the server clock is " +
                "wrong. Purge is refused rather than computed against an untrustworthy instant.",
            daysRemaining: 0,
        };
    }

    const deadline = retentionDeadline(clock, years);
    const remainingMs = deadline.getTime() - now.getTime();

    if (remainingMs > 0) {
        return {
            eligible: false,
            purgeAfterIso: deadline.toISOString(),
            retentionYears: years,
            code: "RETENTION_NOT_ELAPSED",
            reason:
                `Retention has not elapsed. This record is retained for ${years} year(s) after the end of the ` +
                `employment relationship and cannot be purged before ${deadline.toISOString()}. ${RETENTION_POLICY_SOURCE}`,
            // Round UP: reporting 0.4 days remaining as "0 days remaining"
            // would understate how long the operator has to wait.
            daysRemaining: Math.ceil(remainingMs / (24 * 60 * 60 * 1000)),
        };
    }

    return {
        eligible: true,
        purgeAfterIso: deadline.toISOString(),
        retentionYears: years,
        code: null,
        reason: null,
        daysRemaining: 0,
    };
}

/* ------------------------------------------------------------------ */
/* The query predicates                                                 */
/* ------------------------------------------------------------------ */

/**
 * The one predicate that means "not archived".
 *
 * Every operational listing must carry this. It is exported rather than written
 * inline at each call site so that a future `deletedAt`-aware query is written
 * the same way as the existing ones, and so `tests/employee-retention-*` can
 * assert against the exact object rather than against a substring.
 *
 * Frozen so a caller cannot mutate a shared literal.
 */
export const NOT_ARCHIVED = Object.freeze({ deletedAt: null } as const);

/**
 * The guard for a guarded archive write: the row must exist AND not already be
 * archived. This is what makes archiving idempotent at the database level — two
 * concurrent archive requests cannot both match, because the first one sets
 * `deletedAt` and the second's `deletedAt: null` no longer matches.
 */
export function archiveGuard(id: string): { id: string; deletedAt: null } {
    return { id, deletedAt: null };
}

/**
 * The single guarded write that archives. `deletedAt` and `isActive` are set in
 * ONE `data` object so there is no window in which a row is archived but still
 * flagged active, or inactive but not yet archived.
 *
 * `isActive: false` is not redundant with `deletedAt`. It is the column that
 * existing operational queries already read, so it is what makes the archive
 * take effect across the ~20 call sites that filter `isActive: true` without
 * anyone having to touch them. `deletedAt` is the durable, indexed tombstone.
 */
export function archiveWrite(now: Date): { deletedAt: Date; isActive: false } {
    assertUsableDate(now, "now");
    return { deletedAt: now, isActive: false };
}

/**
 * The mirror image, used by `restoreEmployee`. Guarded on `deletedAt: { not:
 * null }` for the same idempotency reason.
 *
 * `isActive` is the CALLER's decision, not this helper's, so it is a required
 * argument: archive set the column to false and for most rows restoring that
 * value is correct, but for a row archived AFTER a terminal exit it would put a
 * departed employee back into headcount, payroll and attendance. The caller
 * decides, using `isTerminalEmploymentState` (lib/employees/lifecycle-stage.ts),
 * and this function only writes what it is told in one object with the
 * tombstone.
 */
export function restoreWrite(reactivate: boolean): { deletedAt: null; isActive: boolean } {
    return { deletedAt: null, isActive: reactivate };
}

/** True when the row is archived. The inverse of the `NOT_ARCHIVED` filter. */
export function isArchived(row: { deletedAt?: Date | null } | null | undefined): boolean {
    return !!row && row.deletedAt !== null && row.deletedAt !== undefined;
}
