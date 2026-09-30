/**
 * Which `Employee.lifecycle` stage a completed exit may land on.
 *
 * `Employee.lifecycle` is governed by `LIFECYCLE_TRANSITIONS` in
 * `lib/workflow/recruitment-machine.ts`, and that map has two properties that
 * decide this whole module:
 *
 *   1. `RESIGNED` is never the TARGET of any transition. It exists in
 *      `EMPLOYEE_LIFECYCLE` and in `app/employees/[id]/lifecycle-stage.ts`, but
 *      nothing in the map can move an employee onto it. So "a resignation
 *      completes, therefore lifecycle = RESIGNED" is not a legal write — it is
 *      an unreachable state that the UI would then have to render as drift.
 *   2. `EXITED` is reachable only from `NOTICE_PERIOD`, `RESIGNED` and
 *      `TERMINATED`. From an employed stage (`ACTIVE`, `PROBATION`,
 *      `CONFIRMED`, `ON_LEAVE`) the only terminal target is `TERMINATED`.
 *
 * This resolver reads both facts off the map instead of encoding them, so a
 * change to `LIFECYCLE_TRANSITIONS` is picked up automatically.
 *
 * It deliberately returns `null` when nothing legal is reachable — for example
 * from `PRE_JOINING`, which no exit should ever start from. A completed exit
 * that reports "HR must fix the lifecycle stage" is a far better outcome than
 * one that writes a stage no transition can produce and no other part of the
 * application agrees with.
 */

import {
    canTransition,
    type TransitionMap,
} from "@/lib/workflow/state-machine";
import {
    EMPLOYEE_LIFECYCLE,
    LIFECYCLE_TRANSITIONS,
} from "@/lib/workflow/recruitment-machine";

/**
 * Preference order. `EXITED` means "the exit is closed" and is the honest
 * terminal stage when it is reachable; `TERMINATED` is the fallback because it
 * is the only terminal target the map allows from an employed stage.
 */
const TERMINAL_PREFERENCE: readonly string[] = [
    EMPLOYEE_LIFECYCLE.EXITED,
    EMPLOYEE_LIFECYCLE.TERMINATED,
];

/**
 * Returns the lifecycle stage to write, or null when the state machine permits
 * no legal move from `current` for this actor.
 *
 * @param current The employee's lifecycle value as stored, or null when unset.
 * @param actorRole The completing user's role, because `LIFECYCLE_TRANSITIONS`
 *                  gates TERMINATED and EXITED on HR/ADMIN/SUPER_ADMIN.
 */
export function resolveTerminalLifecycleStage(
    current: string | null | undefined,
    actorRole: string,
    transitions: TransitionMap = LIFECYCLE_TRANSITIONS
): string | null {
    if (!current) return null;

    for (const candidate of TERMINAL_PREFERENCE) {
        if (canTransition(transitions, current, candidate, { actorRole }).allowed) {
            return candidate;
        }
    }
    return null;
}

/** The stages a completed exit can reach, for the UI's "what will change" note. */
export function reachableTerminalStages(
    current: string | null | undefined,
    actorRole: string
): string[] {
    if (!current) return [];
    return TERMINAL_PREFERENCE.filter((candidate) =>
        canTransition(LIFECYCLE_TRANSITIONS, current, candidate, { actorRole }).allowed
    );
}