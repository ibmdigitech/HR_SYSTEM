/**
 * Effective permission resolution — the ONE authoritative resolver.
 *
 * Resolution order (per RBAC-001 remediation):
 *
 *   User
 *    └─> Role                  (User.role, string column — normalised safely)
 *        └─> Role Permissions   (static grant table below)
 *            └─> User Overrides (DENY wins, then ALLOW)
 *                └─> Scope      (organisational boundary, see scope.ts)
 *                    └─> Effective permissions
 *
 * Design rules:
 *  - DENY always beats ALLOW. An override can remove a capability a role grants.
 *  - An unrecognised or missing role resolves to STAFF (least privilege).
 *  - Nothing here trusts a client-supplied value; callers pass the server-side
 *    role loaded from the database.
 */

import { Role, ROLES, toRole } from "./roles";

/* ------------------------------------------------------------------ */
/* Permission catalog                                                  */
/* ------------------------------------------------------------------ */

export const PERMISSIONS = {
    // System
    SYSTEM_CONFIG: "system.config",
    SYSTEM_AUDIT_VIEW: "system.audit.view",
    /**
     * View backup status and run the backup/restore tooling.
     *
     * Its own permission rather than a reuse of `system.audit.view`, because the
     * two surfaces have different audiences: audit logs are read by HR as part of
     * their job, whereas backup status exposes host paths, container names and
     * scheduled-task state. Reusing one permission would either leak that to HR
     * or hide the backup page from an administrator who should see it — and the
     * sidebar link and the page gate must agree, or the link leads to a refusal.
     */
    SYSTEM_BACKUP_VIEW: "system.backup.view",
    SYSTEM_USER_MANAGE: "system.user.manage",
    SYSTEM_SEED: "system.seed",

    // Employees
    EMPLOYEES_VIEW: "employees.view",
    EMPLOYEES_CREATE: "employees.create",
    EMPLOYEES_EDIT: "employees.edit",
    EMPLOYEES_DELETE: "employees.delete",
    EMPLOYEES_IMPORT: "employees.import",
    EMPLOYEES_EXPORT: "employees.export",
    /**
     * Approve a pending `EmployeeChangeRequest`.
     *
     * This is deliberately NOT `employees.create` or `employees.edit`.
     *
     * Every other approval domain already owns a dedicated `*.approve`
     * permission - `leave.approve`, `letter.approve`, `request.approve`,
     * `service.approve`. Employee data changes were the sole exception: the
     * approvals page gated its Data Changes tab on `canManageEmployees`, and
     * `approveChangeRequest`/`rejectChangeRequest` required `EMPLOYEES_CREATE`.
     *
     * Two real consequences followed from that borrowing:
     *   - MANAGER holds `leave.approve` but not `employees.create`, so a
     *     manager could approve a subordinate's leave yet was shown no Data
     *     Changes tab and was refused if they navigated to it directly.
     *   - HR could not delegate "may approve corrections" without also handing
     *     over "may rewrite any employee's record". Those are different risks
     *     and conflating them means the safer grant is never made.
     */
    EMPLOYEES_APPROVE: "employees.approve",

    // Attendance
    ATTENDANCE_VIEW: "attendance.view",
    ATTENDANCE_MARK: "attendance.mark",
    ATTENDANCE_MANAGE: "attendance.manage",
    ATTENDANCE_IMPORT: "attendance.import",
    ATTENDANCE_EXPORT: "attendance.export",
    ATTENDANCE_SHIFT_MANAGE: "attendance.shift.manage",
    ATTENDANCE_MACHINE: "attendance.machine",

    // Leave
    LEAVE_VIEW: "leave.view",
    LEAVE_APPLY: "leave.apply",
    LEAVE_APPROVE: "leave.approve",
    LEAVE_MANAGE: "leave.manage",

    // Payroll
    PAYROLL_VIEW: "payroll.view",
    PAYROLL_GENERATE: "payroll.generate",
    PAYROLL_STRUCTURE_MANAGE: "payroll.structure.manage",
    PAYROLL_PAYSLIP_VIEW_ALL: "payroll.payslip.view.all",
    PAYROLL_EXPORT: "payroll.export",
    PAYROLL_OVERTIME_MANAGE: "payroll.overtime.manage",
    /** Freeze a period so its inputs can no longer be edited. */
    PAYROLL_LOCK: "payroll.lock",
    /** Final settlement of an offboarding case. */
    PAYROLL_SETTLE: "payroll.settle",
    /** Unlock a frozen period. Deliberately separated from PAYROLL_LOCK. */
    PAYROLL_UNLOCK: "payroll.unlock",

    // Loans
    LOAN_VIEW: "loan.view",
    LOAN_APPLY: "loan.apply",
    LOAN_APPROVE: "loan.approve",
    LOAN_MANAGE: "loan.manage",

    // Letters
    LETTER_VIEW: "letter.view",
    LETTER_GENERATE: "letter.generate",
    LETTER_APPROVE: "letter.approve",
    LETTER_TEMPLATE_MANAGE: "letter.template.manage",

// Visa & compliance
    VISA_VIEW: "visa.view",
    VISA_MANAGE: "visa.manage",

    // Business travel & air ticket entitlement
    /** See travel requests. Scope decides whose: SELF by default. */
    TRAVEL_VIEW: "travel.view",
    /** See the whole entitlement register rather than only one's own record. */
    TRAVEL_VIEW_ALL: "travel.view.all",
    /** Raise a travel request for oneself. */
    TRAVEL_REQUEST: "travel.request",
    /** Raise a travel request on another employee's behalf. */
    TRAVEL_REQUEST_ANY: "travel.request.any",
    /** Approve, reject, or complete a travel request. */
    TRAVEL_APPROVE: "travel.approve",
    /** Set the yearly ticket entitlement, cabin class, and visa anchor date. */
    TRAVEL_ENTITLEMENT_MANAGE: "travel.entitlement.manage",

    // Requests & services
    REQUEST_VIEW: "request.view",
    REQUEST_CREATE: "request.create",
    REQUEST_APPROVE: "request.approve",
    SERVICE_VIEW: "service.view",
    SERVICE_CREATE: "service.create",
    SERVICE_APPROVE: "service.approve",

    // Recruitment
    /** Read requisitions, jobs, candidates, applications. */
    RECRUITMENT_VIEW: "recruitment.view",
    /** Create/edit requisitions, jobs, candidates, applications. */
    RECRUITMENT_CREATE: "recruitment.create",
    RECRUITMENT_EDIT: "recruitment.edit",
    /** Move a requisition through its approval chain. */
    RECRUITMENT_APPROVE: "recruitment.approve",
    /** Schedule, reschedule, cancel interviews. */
    RECRUITMENT_INTERVIEW: "recruitment.interview",
    /** Draft, issue and revise offers. */
    RECRUITMENT_OFFER: "recruitment.offer",
    /** Convert a candidate to an employee. Reserved, like employee deletion. */
    RECRUITMENT_CONVERT: "recruitment.convert",

    // Performance
    PERFORMANCE_VIEW: "performance.view",
    PERFORMANCE_REVIEW: "performance.review",
    PERFORMANCE_APPROVE: "performance.approve",

    // Training
    TRAINING_VIEW: "training.view",
    TRAINING_MANAGE: "training.manage",

    // Exit
    RESIGNATION_VIEW: "resignation.view",
    RESIGNATION_CREATE: "resignation.create",
    RESIGNATION_APPROVE: "resignation.approve",
    TERMINATION_VIEW: "termination.view",
    TERMINATION_CREATE: "termination.create",
    TERMINATION_APPROVE: "termination.approve",
    EXIT_CLEARANCE: "exit.clearance",
    EXIT_SETTLEMENT: "exit.settlement",
    EXIT_COMPLETE: "exit.complete",
    EXIT_INTERVIEW: "exit.interview",

    // Notifications
    NOTIFICATION_VIEW: "notification.view",
    NOTIFICATION_MANAGE: "notification.manage",

    // Settings
    SETTINGS_VIEW: "settings.view",
    SETTINGS_MANAGE: "settings.manage",
    SERVICE_CONFIG_MANAGE: "service.config.manage",

    // Access control
    ACCESS_REQUEST: "access.request",
    ACCESS_APPROVE: "access.approve",

    // Recruitment
    /// Coarse grant kept for backwards compatibility. New code should use the
    /// granular recruitment.* capabilities declared above.
    RECRUITMENT_MANAGE: "recruitment.manage",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/* ------------------------------------------------------------------ */
/* Role → permission grants                                            */
/* ------------------------------------------------------------------ */

/** Capabilities every authenticated account has, regardless of role. */
const BASE_GRANTS: readonly Permission[] = [
    PERMISSIONS.NOTIFICATION_VIEW,
    PERMISSIONS.ACCESS_REQUEST,
];

/** Self-service capabilities for a regular employee. */
const STAFF_GRANTS: readonly Permission[] = [
    ...BASE_GRANTS,
    PERMISSIONS.RESIGNATION_CREATE,
    PERMISSIONS.ATTENDANCE_VIEW,
    PERMISSIONS.ATTENDANCE_MARK,
    PERMISSIONS.LEAVE_VIEW,
    PERMISSIONS.LEAVE_APPLY,
    PERMISSIONS.LOAN_VIEW,
    PERMISSIONS.LOAN_APPLY,
    PERMISSIONS.LETTER_VIEW,
PERMISSIONS.VISA_VIEW,
    // A staff member may raise their own business travel request, and may see
    // their own entitlement and visa anchor. Neither TRAVEL_VIEW_ALL nor
    // TRAVEL_APPROVE is granted: a traveller deciding their own trip is exactly
    // what the maker-checker guard in TRAVEL_REQUEST_TRANSITIONS prevents.
    PERMISSIONS.TRAVEL_VIEW,
    PERMISSIONS.TRAVEL_REQUEST,
    PERMISSIONS.REQUEST_VIEW,
    PERMISSIONS.REQUEST_CREATE,
    PERMISSIONS.SERVICE_VIEW,
    PERMISSIONS.SERVICE_CREATE,
];

/** Team scope additions for a department manager. */
const MANAGER_GRANTS: readonly Permission[] = [
    ...STAFF_GRANTS,
    PERMISSIONS.LEAVE_APPROVE,
    PERMISSIONS.REQUEST_APPROVE,
    PERMISSIONS.SERVICE_APPROVE,
    // A manager already approves leave, staff-service requests, travel and loans
    // for their team, but held no `employees.*` permission at all — which locked
    // them out of the Data Changes queue entirely. Correcting a subordinate's
    // passport or bank detail is the same kind of decision, so refusing it while
    // allowing the rest was incoherent rather than a security boundary.
    //
    // APPROVE only. Not `employees.edit`, because the manager decides whether a
    // submitted change is accepted; they do not get to rewrite a record directly,
    // and `advanceChangeRequest` additionally scopes them to their own direct
    // reports so the grant cannot be used to approve a stranger's corrections.
    PERMISSIONS.EMPLOYEES_APPROVE,
    PERMISSIONS.ATTENDANCE_EXPORT,
    PERMISSIONS.LETTER_VIEW,
    PERMISSIONS.VISA_VIEW,
    // A manager sees their department's travel and decides it, but cannot set
    // an entitlement — that changes what the company owes.
    PERMISSIONS.TRAVEL_VIEW_ALL,
    PERMISSIONS.TRAVEL_APPROVE,
];

/** Finance / payroll department. */
const FINANCE_GRANTS: readonly Permission[] = [
    ...BASE_GRANTS,
    PERMISSIONS.PAYROLL_VIEW,
    PERMISSIONS.PAYROLL_GENERATE,
    PERMISSIONS.PAYROLL_STRUCTURE_MANAGE,
    PERMISSIONS.PAYROLL_PAYSLIP_VIEW_ALL,
    PERMISSIONS.PAYROLL_EXPORT,
    PERMISSIONS.PAYROLL_OVERTIME_MANAGE,
    PERMISSIONS.LOAN_VIEW,
    PERMISSIONS.LOAN_APPROVE,
    PERMISSIONS.LOAN_MANAGE,
    PERMISSIONS.PAYROLL_LOCK,
    PERMISSIONS.PAYROLL_SETTLE,
    PERMISSIONS.RECRUITMENT_OFFER,
    PERMISSIONS.EXIT_SETTLEMENT,
];

const HR_GRANTS: readonly Permission[] = [
    ...STAFF_GRANTS,
    PERMISSIONS.EMPLOYEES_VIEW,
    PERMISSIONS.EMPLOYEES_CREATE,
    PERMISSIONS.EMPLOYEES_EDIT,
    PERMISSIONS.EMPLOYEES_APPROVE,
    PERMISSIONS.EMPLOYEES_IMPORT,
    PERMISSIONS.EMPLOYEES_EXPORT,
    PERMISSIONS.ATTENDANCE_VIEW,
    PERMISSIONS.ATTENDANCE_MANAGE,
    PERMISSIONS.ATTENDANCE_IMPORT,
    PERMISSIONS.ATTENDANCE_EXPORT,
    PERMISSIONS.ATTENDANCE_SHIFT_MANAGE,
    PERMISSIONS.ATTENDANCE_MACHINE,
    PERMISSIONS.LEAVE_APPROVE,
    PERMISSIONS.LEAVE_MANAGE,
    PERMISSIONS.LETTER_GENERATE,
    PERMISSIONS.LETTER_APPROVE,
    PERMISSIONS.LETTER_TEMPLATE_MANAGE,
    PERMISSIONS.VISA_MANAGE,
    // HR owns the entitlement contract: who gets one ticket, who gets two, in
    // what cabin, anchored to which visa date.
    PERMISSIONS.TRAVEL_VIEW_ALL,
    PERMISSIONS.TRAVEL_REQUEST_ANY,
    PERMISSIONS.TRAVEL_APPROVE,
    PERMISSIONS.TRAVEL_ENTITLEMENT_MANAGE,
    PERMISSIONS.REQUEST_APPROVE,
    PERMISSIONS.SERVICE_APPROVE,
    PERMISSIONS.RECRUITMENT_MANAGE,
    PERMISSIONS.RECRUITMENT_VIEW,
    PERMISSIONS.RECRUITMENT_CREATE,
    PERMISSIONS.RECRUITMENT_EDIT,
    PERMISSIONS.RECRUITMENT_APPROVE,
    PERMISSIONS.RECRUITMENT_INTERVIEW,
    PERMISSIONS.RECRUITMENT_OFFER,
    PERMISSIONS.RECRUITMENT_CONVERT,
    PERMISSIONS.EXIT_CLEARANCE,
    PERMISSIONS.EXIT_SETTLEMENT,
    PERMISSIONS.RESIGNATION_VIEW,
    PERMISSIONS.RESIGNATION_CREATE,
    PERMISSIONS.RESIGNATION_APPROVE,
    PERMISSIONS.TERMINATION_VIEW,
    PERMISSIONS.TERMINATION_CREATE,
    PERMISSIONS.TERMINATION_APPROVE,
    PERMISSIONS.PERFORMANCE_APPROVE,
    PERMISSIONS.TRAINING_MANAGE,
    PERMISSIONS.SETTINGS_VIEW,
];

const ADMIN_GRANTS: readonly Permission[] = [
    ...HR_GRANTS,
    ...FINANCE_GRANTS,
    PERMISSIONS.EMPLOYEES_DELETE,
    PERMISSIONS.SYSTEM_USER_MANAGE,
    PERMISSIONS.SYSTEM_AUDIT_VIEW,
    // Backup status is infrastructure state, not people data, so it starts at
    // ADMIN rather than HR. Matches the page gate on /system/backup.
    PERMISSIONS.SYSTEM_BACKUP_VIEW,
    PERMISSIONS.ACCESS_APPROVE,
    PERMISSIONS.PAYROLL_UNLOCK,
    PERMISSIONS.EXIT_COMPLETE,
    PERMISSIONS.EXIT_INTERVIEW,
    PERMISSIONS.RESIGNATION_VIEW,
    PERMISSIONS.RESIGNATION_CREATE,
    PERMISSIONS.RESIGNATION_APPROVE,
    PERMISSIONS.TERMINATION_VIEW,
    PERMISSIONS.TERMINATION_CREATE,
    PERMISSIONS.TERMINATION_APPROVE,
    PERMISSIONS.PERFORMANCE_VIEW,
    PERMISSIONS.PERFORMANCE_REVIEW,
    PERMISSIONS.TRAINING_VIEW,
    PERMISSIONS.NOTIFICATION_MANAGE,
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.SERVICE_CONFIG_MANAGE,
    PERMISSIONS.LETTER_TEMPLATE_MANAGE,
];

/** SYSTEM_SEED is deliberately NOT in any static grant — see guards.ts. */
const SUPER_ADMIN_GRANTS: readonly Permission[] = [
    ...ADMIN_GRANTS,
    PERMISSIONS.SYSTEM_CONFIG,
    PERMISSIONS.SYSTEM_SEED,
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
    [ROLES.STAFF]: STAFF_GRANTS,
    [ROLES.MANAGER]: MANAGER_GRANTS,
    [ROLES.FINANCE]: FINANCE_GRANTS,
    [ROLES.HR]: HR_GRANTS,
    [ROLES.ADMIN]: ADMIN_GRANTS,
    [ROLES.SUPER_ADMIN]: SUPER_ADMIN_GRANTS,
};

/* ------------------------------------------------------------------ */
/* Overrides                                                           */
/* ------------------------------------------------------------------ */

export interface PermissionOverrides {
    /** Capabilities explicitly removed for this user. Wins over everything. */
    deny?: readonly string[];
    /** Capabilities explicitly added for this user. Applied after deny. */
    allow?: readonly string[];
}

/* ------------------------------------------------------------------ */
/* Effective permission resolution                                     */
/* ------------------------------------------------------------------ */

export interface EffectivePermissions {
    role: Role;
    /** Final capability set after role grants + overrides. */
    permissions: ReadonlySet<string>;
    /** True when every catalogued permission is granted (SUPER_ADMIN). */
    isSuperAdmin: boolean;
}

export function resolvePermissions(
    roleInput: unknown,
    overrides?: PermissionOverrides | null
): EffectivePermissions {
    const role = toRole(roleInput);
    const resolved = new Set<string>(ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS[ROLES.STAFF]);

    // ALLOW is applied first so that DENY can always override it below.
    for (const p of overrides?.allow ?? []) {
        if (typeof p === "string" && p.length > 0) resolved.add(p);
    }
    for (const p of overrides?.deny ?? []) {
        if (typeof p === "string") resolved.delete(p);
    }

    return { role, permissions: resolved, isSuperAdmin: role === ROLES.SUPER_ADMIN };
}

export function hasPermission(
    roleInput: unknown,
    permission: Permission | string,
    overrides?: PermissionOverrides | null
): boolean {
    return resolvePermissions(roleInput, overrides).permissions.has(permission);
}

export function hasAnyPermission(
    roleInput: unknown,
    required: readonly (Permission | string)[],
    overrides?: PermissionOverrides | null
): boolean {
    if (required.length === 0) return false;
    const { permissions } = resolvePermissions(roleInput, overrides);
    return required.some((p) => permissions.has(p));
}

export function hasAllPermissions(
    roleInput: unknown,
    required: readonly (Permission | string)[],
    overrides?: PermissionOverrides | null
): boolean {
    if (required.length === 0) return false;
    const { permissions } = resolvePermissions(roleInput, overrides);
    return required.every((p) => permissions.has(p));
}

/** Every permission granted to a role, sorted — used by the settings UI. */
export function listPermissionsForRole(roleInput: unknown): string[] {
    return [...resolvePermissions(roleInput).permissions].sort();
}

export function listAllRoles(): Role[] {
    return Object.keys(ROLE_PERMISSIONS) as Role[];
}
