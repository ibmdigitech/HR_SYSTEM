/**
 * Approval-queue filters.
 *
 * Extracted from `app/dashboard/approvals/page.tsx` so the rule that decides
 * *whose work an approver can see* is a pure function that can be unit-tested,
 * rather than a Prisma `where` object buried in a JSX component.
 *
 * The original implementation filtered on the legacy `managerStatus` /
 * `hrStatus` columns while the P1.3 state machine in `lib/workflow/leave.ts`
 * validates transitions against the canonical `status` field. Two sources of
 * truth for one piece of state means a request can be invisible to the very
 * person who must approve it — and it fails silently, so nobody notices the
 * queue is short. Everything here keys off `status`.
 */

import { LEAVE_STATUS } from "@/lib/workflow/state-machine";
import { ROLES } from "@/lib/auth/roles";
import { hasPermission, PERMISSIONS } from "@/lib/auth/permissions";

/** The `where` clause Prisma expects; kept loose because it is composed. */
export type LeaveQueueWhere = Record<string, unknown>;

export interface LeaveQueueInput {
    role: string;
    /** The approver's own employee id, needed to scope a manager's queue. */
    approverEmployeeId?: string | null;
}

/**
 * True when the role may act on the HR stage of leave approval.
 *
 * Deliberately permission-based rather than `role === "HR" || role === "ADMIN"`:
 * the hardcoded pair silently excluded SUPER_ADMIN, who holds
 * `leave.approve` by inheritance from the ADMIN grants, leaving that account
 * with an empty queue and no error. FINANCE holds no `leave.approve` and is
 * correctly excluded.
 */
export function canApproveLeave(roleInput: unknown): boolean {
    return hasPermission(roleInput, PERMISSIONS.LEAVE_APPROVE);
}

/**
 * Builds the leave-queue filter for a given approver.
 *
 * - MANAGER: requests from their own direct reports, at the manager stage only.
 * - Any role holding `leave.approve` (HR, ADMIN, SUPER_ADMIN): requests the
 *   manager has signed off, now at the HR stage.
 * - Anyone else: `null`, meaning "no queue" rather than "queue everything".
 *
 * `MANAGER_APPROVED` is a legal target in `LEAVE_TRANSITIONS` but is never
 * actually assigned to a `LeaveRequest` row — the workflow goes straight from
 * `PENDING_MANAGER` to either `PENDING_HR` or `APPROVED` depending on policy
 * — so it is intentionally not matched here. Including it would be harmless
 * but would imply it is reachable, which it is not.
 */
export function buildLeaveQueueWhere({ role, approverEmployeeId }: LeaveQueueInput): LeaveQueueWhere | null {
    if (role === ROLES.MANAGER) {
        if (!approverEmployeeId) return null;
        return {
            status: LEAVE_STATUS.PENDING_MANAGER,
            employee: { managerId: approverEmployeeId },
        };
    }

    if (canApproveLeave(role)) {
        return { status: LEAVE_STATUS.PENDING_HR };
    }

    return null;
}

/** True when any of the leave request's status columns is referenced. */
export function referencesLegacyStatusColumns(where: LeaveQueueWhere | null): boolean {
    if (!where) return false;
    const keys = Object.keys(where);
    return keys.includes("managerStatus") || keys.includes("hrStatus");
}
