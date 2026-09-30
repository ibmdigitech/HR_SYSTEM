/**
 * Approval-queue filter tests.
 *
 * Guards the rule that decides whose pending work an approver can see. This is
 * the highest-consequence filter in the product: get it wrong and work becomes
 * invisible to the person who must clear it, with no error anywhere.
 *
 * The specific regression these lock down: the queue used to filter on the
 * legacy `managerStatus` / `hrStatus` columns while the workflow state machine
 * validates transitions against the canonical `status` field. Two sources of
 * truth for one piece of state.
 */
import { describe, it, expect } from "vitest";

import {
    buildLeaveQueueWhere,
    canApproveLeave,
    referencesLegacyStatusColumns,
} from "@/lib/approvals/leave-queue";
import { LEAVE_STATUS } from "@/lib/workflow/state-machine";
import { ROLES } from "@/lib/auth/roles";

describe("canApproveLeave", () => {
    it("is true for roles holding leave.approve", () => {
        expect(canApproveLeave(ROLES.MANAGER)).toBe(true);
        expect(canApproveLeave(ROLES.HR)).toBe(true);
        expect(canApproveLeave(ROLES.ADMIN)).toBe(true);
        // SUPER_ADMIN inherits every ADMIN grant, including leave.approve. A
        // hardcoded `role === "HR" || role === "ADMIN"` check silently excluded
        // this role and showed a super admin an empty queue.
        expect(canApproveLeave(ROLES.SUPER_ADMIN)).toBe(true);
    });

    it("is false for roles without leave.approve", () => {
        expect(canApproveLeave(ROLES.STAFF)).toBe(false);
        expect(canApproveLeave(ROLES.FINANCE)).toBe(false);
    });
});

describe("buildLeaveQueueWhere", () => {
    it("gives a manager only their own direct reports at the manager stage", () => {
        const where = buildLeaveQueueWhere({ role: ROLES.MANAGER, approverEmployeeId: "emp-mgr" });

        expect(where).toEqual({
            status: LEAVE_STATUS.PENDING_MANAGER,
            employee: { managerId: "emp-mgr" },
        });
    });

    it("gives a manager no queue at all when they have no employee record", () => {
        // Without an id, scoping to "their reports" is impossible. Returning
        // everything would expose the whole company; returning null shows an
        // honest empty queue instead.
        expect(buildLeaveQueueWhere({ role: ROLES.MANAGER, approverEmployeeId: null })).toBeNull();
        expect(buildLeaveQueueWhere({ role: ROLES.MANAGER })).toBeNull();
    });

    it("gives HR the requests the manager has already signed off", () => {
        expect(buildLeaveQueueWhere({ role: ROLES.HR, approverEmployeeId: "emp-hr" })).toEqual({
            status: LEAVE_STATUS.PENDING_HR,
        });
    });

    it("gives SUPER_ADMIN the same queue as HR", () => {
        expect(buildLeaveQueueWhere({ role: ROLES.SUPER_ADMIN })).toEqual({
            status: LEAVE_STATUS.PENDING_HR,
        });
    });

    it("gives no queue to a role that cannot approve leave", () => {
        expect(buildLeaveQueueWhere({ role: ROLES.STAFF, approverEmployeeId: "emp-s" })).toBeNull();
        expect(buildLeaveQueueWhere({ role: ROLES.FINANCE, approverEmployeeId: "emp-f" })).toBeNull();
    });

    it("never matches a request that is already decided", () => {
        // The decisive regression: a request in a terminal state must not appear
        // in anyone's queue, or an approver can act on work already finished.
        for (const terminal of [LEAVE_STATUS.APPROVED, LEAVE_STATUS.REJECTED, LEAVE_STATUS.CANCELLED]) {
            const hr = buildLeaveQueueWhere({ role: ROLES.HR });
            const mgr = buildLeaveQueueWhere({ role: ROLES.MANAGER, approverEmployeeId: "emp-mgr" });

            expect(hr?.status).not.toBe(terminal);
            expect(mgr?.status).not.toBe(terminal);
        }
    });

    it("does not overlap the manager and HR queues", () => {
        // A request must be actionable by exactly one role at a time. If the two
        // filters ever matched the same status, the same leave would sit in two
        // managers' queues simultaneously.
        const mgr = buildLeaveQueueWhere({ role: ROLES.MANAGER, approverEmployeeId: "emp-mgr" });
        const hr = buildLeaveQueueWhere({ role: ROLES.HR });

        expect(mgr?.status).not.toBe(hr?.status);
    });

    it("regression: never filters on the legacy status columns", () => {
        for (const role of [ROLES.MANAGER, ROLES.HR, ROLES.ADMIN, ROLES.SUPER_ADMIN]) {
            expect(referencesLegacyStatusColumns(buildLeaveQueueWhere({ role, approverEmployeeId: "e" }))).toBe(
                false
            );
        }
    });
});

describe("referencesLegacyStatusColumns", () => {
    it("detects the legacy shape that caused the bug", () => {
        expect(referencesLegacyStatusColumns({ managerStatus: "PENDING" })).toBe(true);
        expect(referencesLegacyStatusColumns({ hrStatus: "PENDING" })).toBe(true);
    });

    it("treats a null queue as free of legacy columns", () => {
        expect(referencesLegacyStatusColumns(null)).toBe(false);
    });
});
