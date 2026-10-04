/**
 * The rule that keeps `Employee.lifecycle` from being destroyed by a routine
 * save, and that decides whether a row may be reactivated at all.
 *
 * WHY THIS IS A SEPARATE MODULE
 * `app/lib/actions/employees.ts` carries `"use server"`, so it may export only
 * async functions — the rule could not live next to its caller as a value that
 * anything can assert on. Two callers need it, and they ask different
 * questions of the same three columns: `upsertEmployee` asks "what stage should
 * this row carry after this save?", `restoreEmployee` asks "may this row be
 * reactivated?". Both answers come from one vocabulary, so they live together.
 * The module is pure and has no imports, which also means a bare `node` script
 * can load it and assert the rule without a build step.
 *
 * THE DEFECT THIS EXISTS TO STOP
 * `lifecycle` carries PROBATION and CONFIRMED — the stages
 * `LIFECYCLE_TRANSITIONS` (lib/workflow/recruitment-machine.ts:365) exists to
 * police, and the stage `joining.ts:197` writes when a candidate is converted.
 * The entry form's `currentStatus` enum (app/lib/validation.ts:83) has NO member
 * for either, so deriving `lifecycle` from `currentStatus` on every full save
 * rewrote "PROBATION" as "ACTIVE" the first time HR saved that person's
 * profile, silently dropping the stage the recruitment machine tracks.
 *
 * THE RULE
 * Preserve a stage the status enum cannot express, and derive one only when the
 * incoming `currentStatus` genuinely changes the employment state. The literals
 * below mirror `EMPLOYEE_LIFECYCLE` and the Zod enum; they are restated rather
 * than imported so this module stays free of dependencies.
 */

/**
 * Lifecycle stages the entry form's `currentStatus` enum cannot express.
 * These are preserved by a save rather than derived from the status.
 */
export const STAGES_THE_STATUS_ENUM_CANNOT_EXPRESS: readonly string[] = ["PROBATION", "CONFIRMED"];

/** `currentStatus` values that leave the person employed with the company. */
export const IN_EMPLOYMENT_STATUSES: readonly string[] = ["ACTIVE", "ON_LEAVE"];

/** `currentStatus` values that mean the person is no longer on the workforce. */
export const TERMINAL_STATUSES: readonly string[] = ["RESIGNED", "TERMINATED", "OFFBOARDED"];

/** `lifecycle` stages from which employment does not continue. */
export const TERMINAL_STAGES: readonly string[] = ["RESIGNED", "TERMINATED", "EXITED"];

/**
 * The one status that is not itself a lifecycle stage: OFFBOARDED is an exit
 * workflow state, and EXITED is the terminal employment stage behind it.
 */
const STATUS_TO_STAGE: Record<string, string> = { OFFBOARDED: "EXITED" };

/**
 * The lifecycle stage an employee should carry after a save.
 *
 * `existingLifecycle` is the stage the row has TODAY, or null/undefined for a
 * record that does not exist yet — a new record has no stage to preserve, so the
 * derivation is all there is.
 *
 * Preserved: PROBATION/CONFIRMED while the person stays in employment
 * (ACTIVE or ON_LEAVE). ON_LEAVE is a temporary overlay in
 * `LIFECYCLE_TRANSITIONS`, not a departure, so a confirmed employee marked as on
 * leave is still CONFIRMED.
 *
 * Derived: everything else. A status that really does move the employee —
 * RESIGNED, TERMINATED, OFFBOARDED, or PRE_JOINING when a record is re-staged —
 * always wins over the stage it was in, so the columns cannot silently disagree.
 */
export function lifecycleOnSave(
    existingLifecycle: string | null | undefined,
    currentStatus: string
): string {
    const preserved =
        !!existingLifecycle &&
        STAGES_THE_STATUS_ENUM_CANNOT_EXPRESS.includes(existingLifecycle) &&
        IN_EMPLOYMENT_STATUSES.includes(currentStatus);
    if (preserved) return existingLifecycle as string;
    return STATUS_TO_STAGE[currentStatus] ?? currentStatus;
}

/**
 * True when the row says employment has ended on EITHER axis. Either column is
 * enough: the defect this guards against is a write that moves one and leaves
 * the other, so checking only the column that write happened to touch is how the
 * problem gets through.
 */
export function isTerminalEmploymentState(
    row: { currentStatus?: string | null; lifecycle?: string | null } | null | undefined
): boolean {
    if (!row) return false;
    return TERMINAL_STATUSES.includes(row.currentStatus ?? "") || TERMINAL_STAGES.includes(row.lifecycle ?? "");
}