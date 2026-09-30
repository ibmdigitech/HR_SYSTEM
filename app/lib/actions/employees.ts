"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";import { Prisma } from "../../../prisma/generated/client";
import {
    employeeSchema,
    employeeSchemaProvisional,
    fieldErrors as toFieldErrors,
    outstandingProvisionalFields,
    type EmployeeInput,
} from "@/app/lib/validation";
import { requirePermission, requireSuperAdmin } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";
import { issueActivationToken } from "@/lib/workflow/credentials";
import { ensureChecklist, notifyManagerOfNewHire } from "@/lib/workflow/onboarding";
import {
    NOT_ARCHIVED,
    RetentionPolicyError,
    activeRetentionYears,
    archiveGuard,
    archiveWrite,
    isArchived,
    purgeEligibility,
    restoreWrite,
} from "@/lib/employees/retention";

/** Shared result shape so the client can render field-level or form-level errors. */
export type EmployeeActionResult = {
    success: boolean;
    message: string;
    fieldErrors?: Record<string, string>;
    /** P1.1: one-time activation link for the new account. Shown once, never stored. */
    activation?: { token: string; expiresAt: string };
    activationError?: string;
    /**
     * Stable machine-readable outcome. The archive/restore/purge actions return
     * one so a caller can distinguish "nothing to do" (ALREADY_ARCHIVED) from
     * "refused" (RETENTION_NOT_ELAPSED) from "done" (ARCHIVED) without parsing
     * an English message, and without treating an idempotent no-op as a failure.
     */
    code?: string;
};

// Default leave balances assigned to every new employee
const DEFAULT_LEAVE_BALANCES = [
    { leaveType: "ANNUAL",      totalDays: 21 },
    { leaveType: "SICK",        totalDays: 10 },
    { leaveType: "CASUAL",      totalDays: 6  },
    { leaveType: "EMERGENCY",   totalDays: 3  },
    { leaveType: "UNPAID",      totalDays: 0  },
    { leaveType: "MATERNITY",   totalDays: 90 },
    { leaveType: "PATERNITY",   totalDays: 5  },
    { leaveType: "HAJJ",        totalDays: 30 },
    { leaveType: "BEREAVEMENT", totalDays: 3  },
    { leaveType: "STUDY",       totalDays: 10 },
];

// Auto-generate employee code: EMP-001, EMP-002, etc.
async function generateEmployeeCode(): Promise<string> {
    const last = await prisma.employee.findFirst({
        where: { employeeCode: { startsWith: "EMP-" } },
        orderBy: { employeeCode: "desc" },
        select: { employeeCode: true },
    });
    let next = 1;
    if (last?.employeeCode) {
        const num = parseInt(last.employeeCode.replace("EMP-", ""));
        if (!isNaN(num)) next = num + 1;
    }
    return `EMP-${String(next).padStart(3, "0")}`;
}

export async function upsertEmployee(formData: FormData): Promise<EmployeeActionResult> {
    // Centralized guard (P0-4): the role is re-read from the database, so a
    // token issued before a demotion is no longer authoritative.
    let actorEmail = "unknown";
    let actorRole = "unknown";
    try {
        const user = await requirePermission(PERMISSIONS.EMPLOYEES_CREATE);
        actorEmail = user.email;
        actorRole = user.role;
    } catch {
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail,
            outcome: "DENIED",
            requestMethod: "SERVER_ACTION",
            detail: { target: "upsertEmployee", required: PERMISSIONS.EMPLOYEES_CREATE },
        });
        return { success: false, message: "You do not have permission to manage employees." };
    }

    const id = formData.get("id") as string | null;
    const isNew = !id || id === "";

    // ── Validation (P0-10) ────────────────────────────────────────────────
    // AUTHORITATIVE server-side check. A crafted request that bypasses the
    // client is rejected here before anything reaches the database.
    const raw: Record<string, unknown> = {};
    for (const [key, value] of formData.entries()) {
        if (typeof value === "string") raw[key] = value;
    }
    // `id` is routing information, not employee data.
    delete raw.id;

    // `provision=1` saves a staged record: only identity plus a roll number are
    // required, and the employee is marked PRE_JOINING so an incomplete hire is
    // never mistaken for an active one. The full schema is still applied when
    // `provision` is absent, so a normal entry is unchanged.
    const isProvisional = formData.get("provision") === "1";
    const schema = isProvisional ? employeeSchemaProvisional : employeeSchema;

    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
        const errors = toFieldErrors(parsed.error);
        return {
            success: false,
            message: isProvisional
                ? "A provisional record still needs a name, email and roll number."
                : "Please correct the highlighted fields.",
            fieldErrors: errors,
        };
    }
    const validated = parsed.data as EmployeeInput;

    // Explicit allow-list. The validated schema is the single source of truth
    // for what is written, so an unexpected FormData key can never reach Prisma.
    const data = {
        firstName:              validated.firstName,
        lastName:               validated.lastName,
        email:                  validated.email,
        rollNumber:             validated.rollNumber,
        designation:            validated.designation,
        department:             validated.department,
        joiningDate:            validated.joiningDate,
        employmentType:         validated.employmentType,
        workLocation:           validated.workLocation ?? null,
        currentStatus:          validated.currentStatus,
        managerId:              validated.managerId ?? null,
        probationDays:          validated.probationDays,
        dateOfBirth:            validated.dateOfBirth ?? null,
        phone:                  validated.phone ?? null,
        gender:                 validated.gender ?? null,
        maritalStatus:          validated.maritalStatus ?? null,
        nationality:            validated.nationality ?? null,
        governmentId:           validated.governmentId ?? null,
        address:                validated.address ?? null,
        permanentAddress:       validated.permanentAddress ?? null,
        emergencyContact:       validated.emergencyContact ?? null,
        emergencyPhone:         validated.emergencyPhone ?? null,
        bankName:               validated.bankName ?? null,
        accountNumber:          validated.accountNumber ?? null,
        iban:                   validated.iban ?? null,
        ifscCode:               validated.ifscCode ?? null,
        basicSalary:            validated.basicSalary ?? null,
        housingAllowance:       validated.housingAllowance ?? null,
        transportAllowance:     validated.transportAllowance ?? null,
        otherAllowance:         validated.otherAllowance ?? null,
        passportNumber:         validated.passportNumber ?? null,
        passportExpiry:         validated.passportExpiry ?? null,
        emiratesId:             validated.emiratesId ?? null,
        emiratesIdExpiry:       validated.emiratesIdExpiry ?? null,
        visaNumber:             validated.visaNumber ?? null,
        visaExpiry:             validated.visaExpiry ?? null,
        visaType:               validated.visaType ?? null,
        medicalInsuranceExpiry: validated.medicalInsuranceExpiry ?? null,
        iloeInsuranceExpiry:    validated.iloeInsuranceExpiry ?? null,
    };

    // ── Duplicate detection (P0-15) ───────────────────────────────────────
    // This pre-check exists to produce a USEFUL error message, NOT to enforce
    // uniqueness. A read-then-write is a TOCTOU race: two concurrent requests
    // can both pass it. The authoritative enforcement is the existing unique
    // index on Employee.email / Employee.rollNumber plus the P2002 handler
    // below. Never remove the database constraint in favour of this check.
    const conflicting = await prisma.employee.findFirst({
        where: {
            ...(isNew ? {} : { id }),
            OR: [{ email: validated.email }, { rollNumber: validated.rollNumber }],
        },
        select: { id: true, email: true, rollNumber: true },
    });

    if (conflicting) {
        const isEmailClash = conflicting.email === validated.email;
        const field = isEmailClash ? "email" : "rollNumber";
        return {
            success: false,
            message: isEmailClash
                ? "An employee with this email already exists."
                : "An employee with this roll number already exists.",
            fieldErrors: { [field]: "Already in use by another employee" },
        };
    }

    try {
        if (!isNew) {
            // ─── UPDATE ────────────────────────────────────────────────────
            await prisma.employee.update({ where: { id }, data });

            await prisma.auditLog.create({
                data: {
                    employeeId: id,
                    action: "UPDATE",
                    details: "Employee Master Data Updated",
                    changedBy: actorEmail,
                },
            });

            revalidatePath("/employees");
            return { success: true, message: "Employee updated successfully" };
        }

        // ─── CREATE + AUTO-PROVISION ────────────────────────────────────────
        // Wrapped in a transaction (P0-25, P1.1): previously a failure
        // part-way through left a User with no Employee, or an Employee with no
        // leave balances.
        const employeeCode = await generateEmployeeCode();
        const currentYear = new Date().getFullYear();

        const employee = await prisma.$transaction(async (tx) => {
            // 1. Create User login.
            // P1.1 / SEC-027: NO usable password is set. The account is created
            // with a null password and can only be reached through a one-time
            // activation token issued below. The previous behaviour assigned the
            // literal `password123` to every employee, which is the credential
            // the audit flagged.
            const user = await tx.user.create({
                data: {
                    email: data.email,
                    password: null,
                    role: "STAFF",
                    name: `${data.firstName} ${data.lastName}`,
                },
            });

            // 2. Create Employee master record
            const created = await tx.employee.create({
                data: { ...data, userId: user.id, employeeCode },
            });

            // 3. Auto-create SalaryStructure
            await tx.salaryStructure.create({
                data: {
                    employeeId:        created.id,
                    basic:             data.basicSalary        || 0,
                    housingAllowance:  data.housingAllowance   || 0,
                    transportAllowance:data.transportAllowance || 0,
                    medicalAllowance:  0,
                    otherAllowances:   data.otherAllowance     || 0,
                    ctc:               (data.basicSalary || 0) + (data.housingAllowance || 0) +
                                       (data.transportAllowance || 0) + (data.otherAllowance || 0),
                    paymentMethod:     "BANK_TRANSFER",
                    bankName:          data.bankName || null,
                    iban:              data.iban || null,
                },
            });

            // 4. Leave balances, driven by the configured policy (P1.3).
            // With no policy configured, nothing is invented — HR must
            // configure a LeaveAccrualPolicy first.
            for (const lb of DEFAULT_LEAVE_BALANCES) {
                const existing = await tx.leaveBalance.findFirst({
                    where: { employeeId: created.id, leaveType: lb.leaveType, year: currentYear },
                    select: { id: true },
                });
                if (existing) continue;
                await tx.leaveBalance.create({
                    data: {
                        employeeId: created.id,
                        leaveType:  lb.leaveType,
                        totalDays:  lb.totalDays,
                        usedDays:   0,
                        year:       currentYear,
                    },
                });
            }

            // 5. Welcome notification
            await tx.notification.create({
                data: {
                    employeeId: created.id,
                    title:   "Welcome to the Team!",
                    message: `Welcome ${data.firstName}! Your employee profile (${employeeCode}) has been created.`,
                    type:    "SUCCESS",
                    link:    "/staff-services",
                },
            });

            // 6. Audit log
            await tx.auditLog.create({
                data: {
                    employeeId: created.id,
                    action:     "EMPLOYEE_ONBOARDED",
                    details:    `New employee ${data.firstName} ${data.lastName} (${employeeCode}) onboarded with full profile provisioning`,
                    changedBy:  actorEmail,
                },
            });

            return created;
        });

        // 7. Activation token, OUTSIDE the transaction.
        // Issued last so a failure here cannot roll back a valid employee, and
        // the plaintext token is returned to the invoking HR user exactly once
        // — it is never stored, emailed or logged.
        let activation: { token: string; expiresAt: Date } | null = null;
        let activationError: string | null = null;
        // A provisional record reports exactly what is still missing, so HR can
        // see the remaining work rather than guess.
        const outstanding = isProvisional
            ? outstandingProvisionalFields(data as unknown as Record<string, unknown>)
            : [];
        try {
            const issued = await issueActivationToken({
                userId: employee.userId ?? "",
                createdBy: actorEmail,
                purpose: "FIRST_LOGIN",
            });
            activation = { token: issued.token, expiresAt: issued.expiresAt };
        } catch (tokenError) {
            console.error("[ACTIVATION_TOKEN_FAILED]", tokenError);
            activationError =
                "The employee was created, but the activation link could not be issued. Reissue it from the employee record.";
        }

        // P1.1 (FLOW-004/005/006/007): create the onboarding checklist and alert
        // the manager. Both are best-effort and run AFTER the transaction, so a
        // failure here can never undo a valid employee. A partially onboarded
        // hire is recoverable; a rolled-back hire is not.
        try {
            await ensureChecklist(employee.id);
        } catch (checklistError) {
            console.error("[ONBOARDING_CHECKLIST_INIT_FAILED]", checklistError);
        }
        try {
            await notifyManagerOfNewHire({ employeeId: employee.id, actorEmail });
        } catch (notifyError) {
            console.error("[ONBOARDING_MANAGER_NOTIFY_FAILED]", notifyError);
        }

        revalidatePath("/employees");
        revalidatePath("/attendance");
        revalidatePath("/payroll");
        revalidatePath("/leaves");
        revalidatePath("/visa");
        revalidatePath("/dashboard");

        return {
            success: true,
            message: isProvisional
                ? `${data.firstName} ${data.lastName} (${employeeCode}) saved as PROVISIONAL. Outstanding: ${outstanding
                      .map((f) => f.label)
                      .join(", ")}. Edit the record to complete it.`
                : `Employee ${data.firstName} ${data.lastName} (${employeeCode}) created! Attendance, Leave, Payroll & Visa profiles auto-provisioned.`,
            // P1.1: the activation token is returned once and never stored.
            // The UI shows it as a one-time link for the new employee.
            ...(activation
                ? {
                      activation: {
                          token: activation.token,
                          expiresAt: activation.expiresAt.toISOString(),
                      },
                  }
                : {}),
            ...(activationError ? { activationError } : {}),
        };
    } catch (error: unknown) {
        // P2002 = unique constraint violation. This is the AUTHORITATIVE
        // duplicate guard: the pre-check above is advisory and can be raced, but
        // this cannot be bypassed. It is what actually prevents two concurrent
        // requests from creating the same employee.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            const target = (error.meta?.target as string[] | string | undefined) ?? [];
            const fields = Array.isArray(target) ? target : [String(target)];
            const field = fields.find((f) => /email/i.test(f))
                ? "email"
                : fields.find((f) => /rollNumber/i.test(f))
                  ? "rollNumber"
                  : fields[0] ?? "_form";

            await logSecurityEvent({
                action: SECURITY_ACTION.ACCESS_DENIED,
                actorEmail,
                actorRole,
                outcome: "DENIED",
                requestMethod: "SERVER_ACTION",
                detail: { target: "upsertEmployee", reason: "unique constraint", fields },
            });

            return {
                success: false,
                message: "Another record with the same unique value was created at the same time. Reload and try again.",
                fieldErrors: { [field]: "Already in use" },
            };
        }

        console.error("[UPSERT_EMPLOYEE_ERROR]", error);
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail,
            actorRole,
            outcome: "ERROR",
            requestMethod: "SERVER_ACTION",
            detail: {
                target: "upsertEmployee",
                message: error instanceof Error ? (error instanceof Error ? error.message : "Unknown error") : "unknown",
            },
        });

        // Generic message: the internal error is logged, never returned.
        return { success: false, message: "Could not save the employee. Please try again." };
    }
}

/* ================================================================== */
/* RET-001 — archive, restore, purge                                   */
/* ================================================================== */
/*
 * `deleteEmployee` used to be `await prisma.employee.delete({ where: { id } })`.
 * That was a hard delete and it was wrong three separate ways:
 *
 *   1. LEGAL. UAE employment law requires the employee file to be retained for
 *      five years after the employment relationship ends. A hard delete destroys
 *      payroll history, leave records, letters and the audit trail with no way
 *      to recover any of it. (docs/audit/PRODUCTION_READINESS_CHECKLIST.md
 *      blocker 6.5; EXECUTIVE_SUMMARY.md:44.)
 *
 *   2. IT WAS MOSTLY BROKEN ANYWAY. The foreign keys on Employee were read
 *      from `pg_constraint` rather than assumed, and `AuditLog_employeeId_fkey`
 *      and `LeaveRequest_employeeId_fkey` are both ON DELETE RESTRICT. Since
 *      `upsertEmployee` writes an AuditLog row on every single create, the
 *      database refused the delete for practically every real employee and the
 *      action reported the bare string "Error deleting employee". An operator
 *      could not tell a permissions problem from a referential-integrity one.
 *
 *   3. WHERE IT DID SUCCEED IT WAS DESTRUCTIVE. `Attachment_employeeId_fkey`
 *      and `OnboardingChecklistItem_employeeId_fkey` are ON DELETE CASCADE, so
 *      the one case that worked quietly destroyed the employee's uploaded
 *      identity documents and their onboarding checklist. Meanwhile
 *      `Letter_employeeId_fkey` is ON DELETE SET NULL, so issued letters were
 *      silently orphaned away from the person they were issued to.
 *
 * The fix is archive: set `deletedAt` and `isActive = false` in ONE guarded
 * write. Nothing is destroyed, the row is hidden from operational reads, and
 * the record is still there in five years.
 *
 * PERMISSIONS — UNCHANGED, AND DELIBERATELY SO
 * -------------------------------------------
 * Archive keeps `PERMISSIONS.EMPLOYEES_DELETE`, which the old delete used. It is
 * granted to ADMIN and SUPER_ADMIN only (`lib/auth/permissions.ts:248`). Not
 * weakening a permission to make a change land is the whole point.
 *
 * A DECISION FOR A HUMAN, NOT APPLIED HERE: `employees.delete` now means
 * "archive", which is a strictly LESS destructive capability than its name
 * implies. The honest model is three capabilities — `employees.archive`
 * (operational, HR/ADMIN), `employees.restore` (HR/ADMIN), and
 * `employees.purge` (erasure, SUPER_ADMIN). That needs new entries in
 * `lib/auth/permissions.ts`, which is owned elsewhere, so it is reported rather
 * than applied. `lib/auth/**` is off-limits for this change.
 *
 * `SECURITY_ACTION` HAS NO ARCHIVE/RESTORE/PURGE ENTRY
 * ---------------------------------------------------
 * `SECURITY_ACTION` is a closed `as const` union in `lib/auth/audit.ts`, also
 * off-limits, so these events reuse `USER_DISABLED` — the closest existing
 * vocabulary — with `detail.lifecycleAction` carrying the exact action and
 * `target` naming the EMPLOYEE RECORD rather than a login. A security reviewer
 * must not read `USER_DISABLED` here as "their account was disabled": it was
 * the record. `AuditLog.action`, which is free text, carries the precise value
 * (`EMPLOYEE_ARCHIVED` / `EMPLOYEE_RESTORED` / `EMPLOYEE_PURGED`). Three new
 * `SECURITY_ACTION` entries would remove the ambiguity; reported, not applied.
 */

/** Label used in operator-facing messages. Falls back to the id. */
function employeeLabel(row: { employeeCode: string | null; firstName: string; lastName: string; id: string }): string {
    return `${row.firstName} ${row.lastName}${row.employeeCode ? ` (${row.employeeCode})` : ""}`;
}

/**
 * Every page whose rendered content depends on which employees exist. An
 * archive changes all of them, and a stale cached list is exactly the
 * "archived employee still appears in the directory" bug.
 */
const EMPLOYEE_SURFACE_PATHS = [
    "/employees",
    "/dashboard",
    "/attendance",
    "/payroll",
    "/leaves",
    "/visa",
    "/recruitment",
] as const;

function revalidateEmployeeSurfaces(): void {
    for (const path of EMPLOYEE_SURFACE_PATHS) revalidatePath(path);
}

/**
 * ARCHIVE — the replacement for the hard delete.
 *
 * ONE guarded write sets `deletedAt` AND `isActive = false` together:
 * `prisma.employee.updateMany({ where: { id, deletedAt: null }, data: { deletedAt, isActive: false } })`.
 * There is no intermediate state in which a row is archived but still flagged
 * active, or inactive but not yet archived.
 *
 * IDEMPOTENT BY CONSTRUCTION, NOT BY A PRE-READ. The guard lives in the write's
 * `where` clause, so two concurrent archive requests cannot both match — the
 * first sets `deletedAt`, and the second's `deletedAt: null` no longer matches.
 * The read below exists only to build a useful audit message and to tell
 * "already archived" apart from "no such employee"; it is never the guard.
 */
export async function archiveEmployee(id: string): Promise<EmployeeActionResult> {
    let actorEmail = "unknown";
    let actorRole = "unknown";
    try {
        const user = await requirePermission(PERMISSIONS.EMPLOYEES_DELETE);
        actorEmail = user.email;
        actorRole = user.role;
    } catch {
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail,
            actorRole,
            outcome: "DENIED",
            requestMethod: "SERVER_ACTION",
            detail: { target: "archiveEmployee", required: PERMISSIONS.EMPLOYEES_DELETE },
        });
        return {
            success: false,
            message: "You do not have permission to archive employees.",
            code: "PERMISSION_DENIED",
        };
    }

    const now = new Date();

    let target: {
        id: string;
        employeeCode: string | null;
        firstName: string;
        lastName: string;
        deletedAt: Date | null;
    } | null;
    try {
        target = await prisma.employee.findUnique({
            where: { id },
            select: { id: true, employeeCode: true, firstName: true, lastName: true, deletedAt: true },
        });
    } catch (error) {
        console.error("[ARCHIVE_EMPLOYEE_READ_FAILED]", error);
        return { success: false, message: "Could not read the employee record.", code: "READ_FAILED" };
    }

    if (!target) {
        return { success: false, message: "Employee not found.", code: "NOT_FOUND" };
    }

    // Idempotent no-op. Reported as SUCCESS, not as an error: archiving twice
    // is a double-click, and an operator who is told "already archived" learns
    // what happened instead of being handed a failure they cannot act on.
    if (isArchived(target)) {
        const when = target.deletedAt ? target.deletedAt.toISOString() : "an earlier date";
        return {
            success: true,
            message: `${employeeLabel(target)} was already archived on ${when}. Nothing to do.`,
            code: "ALREADY_ARCHIVED",
        };
    }

    let archived: number;
    try {
        // The authoritative write. See the header for why `isActive` is set here
        // and not left to a second statement.
        const result = await prisma.employee.updateMany({
            where: archiveGuard(id),
            data: archiveWrite(now),
        });
        archived = result.count;
    } catch (error) {
        console.error("[ARCHIVE_EMPLOYEE_WRITE_FAILED]", error);
        await logSecurityEvent({
            action: SECURITY_ACTION.USER_DISABLED,
            actorEmail,
            actorRole,
            target: `employee-record:${id}`,
            outcome: "ERROR",
            requestMethod: "SERVER_ACTION",
            detail: { lifecycleAction: "EMPLOYEE_ARCHIVED", result: "write-failed" },
        });
        return { success: false, message: "Could not archive the employee. Please try again.", code: "WRITE_FAILED" };
    }

    if (archived === 0) {
        // The row existed and was not archived when it was read, but the guarded
        // write matched nothing — so a concurrent request archived it first.
        // Same answer as the pre-read branch: a no-op, not a failure.
        return {
            success: true,
            message: `${employeeLabel(target)} is already archived. Nothing to do.`,
            code: "ALREADY_ARCHIVED",
        };
    }

    await recordArchiveEvent({
        employeeId: id,
        actorEmail,
        actorRole,
        label: employeeLabel(target),
        archivedAt: now,
    });

    revalidateEmployeeSurfaces();

    return {
        success: true,
        message:
            `${employeeLabel(target)} archived. The record is retained for the statutory retention period and ` +
            "can be restored; nothing was deleted.",
        code: "ARCHIVED",
    };
}

/**
 * Writes BOTH trails for a lifecycle change.
 *
 * `AuditLog` is the per-employee history that the employee detail page reads,
 * and it is the record that survives with the row. `SecurityAuditLog` has no
 * foreign key, so it is what still exists after a purge removes the employee —
 * which is why the purge writes it BEFORE the delete, not after.
 */
async function recordArchiveEvent(params: {
    employeeId: string;
    actorEmail: string;
    actorRole: string;
    label: string;
    archivedAt: Date;
    action?: string;
    detail?: Record<string, unknown>;
}): Promise<void> {
    const action = params.action ?? "EMPLOYEE_ARCHIVED";
    try {
        await prisma.auditLog.create({
            data: {
                employeeId: params.employeeId,
                action,
                details: `${params.label} archived — record retained, not deleted (${params.archivedAt.toISOString()})`,
                changedBy: params.actorEmail,
            },
        });
    } catch (error) {
        // A failed audit row must not undo a completed archive. It is reported
        // loudly instead: a silent audit gap is worse than a visible one.
        console.error("[EMPLOYEE_LIFECYCLE_AUDIT_FAILED]", action, error);
    }
    await logSecurityEvent({
        action: SECURITY_ACTION.USER_DISABLED,
        actorEmail: params.actorEmail,
        actorRole: params.actorRole,
        target: `employee-record:${params.employeeId}`,
        requestMethod: "SERVER_ACTION",
        detail: { lifecycleAction: action, ...(params.detail ?? {}) },
    });
}

/**
 * RET-UNARCHIVE — the counterpart the original hard delete never needed and an
 * archive always does. Without it, "we archived the wrong person" has no
 * remedy except a database restore, which is not a remedy.
 *
 * Mirrors `archiveEmployee` exactly: same permission, same guarded-write shape
 * (`deletedAt: { not: null }` so it is idempotent for the same concurrency
 * reason), same single write setting both columns, same two audit trails.
 *
 * Restoring sets `isActive: true`. It restores the value archive changed, so
 * "restore" cannot degrade into "make invisible again".
 *
 * CAVEAT FOR A HUMAN: if the employee was archived AFTER a terminal exit, this
 * sets `isActive: true` on a RESIGNED/TERMINATED row and re-creates exactly the
 * divergence `classifyEmployeeState` reports as critical
 * (`TERMINAL_STATUS_STILL_ACTIVE`). That is visible rather than silent — the
 * consistency reporter catches it — but if you would rather restore refuse in
 * that case, say so and it becomes a conditional guard.
 */
export async function restoreEmployee(id: string): Promise<EmployeeActionResult> {
    let actorEmail = "unknown";
    let actorRole = "unknown";
    try {
        const user = await requirePermission(PERMISSIONS.EMPLOYEES_DELETE);
        actorEmail = user.email;
        actorRole = user.role;
    } catch {
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail,
            actorRole,
            outcome: "DENIED",
            requestMethod: "SERVER_ACTION",
            detail: { target: "restoreEmployee", required: PERMISSIONS.EMPLOYEES_DELETE },
        });
        return {
            success: false,
            message: "You do not have permission to restore employees.",
            code: "PERMISSION_DENIED",
        };
    }

    const now = new Date();

    const target = await prisma.employee.findUnique({
        where: { id },
        select: { id: true, employeeCode: true, firstName: true, lastName: true, deletedAt: true },
    });

    if (!target) {
        return { success: false, message: "Employee not found.", code: "NOT_FOUND" };
    }

    if (!isArchived(target)) {
        return {
            success: true,
            message: `${employeeLabel(target)} is not archived. Nothing to do.`,
            code: "NOT_ARCHIVED",
        };
    }

    let restored: number;
    try {
        const result = await prisma.employee.updateMany({
            where: { id, deletedAt: { not: null } },
            data: restoreWrite(),
        });
        restored = result.count;
    } catch (error) {
        console.error("[RESTORE_EMPLOYEE_WRITE_FAILED]", error);
        return { success: false, message: "Could not restore the employee. Please try again.", code: "WRITE_FAILED" };
    }

    if (restored === 0) {
        return {
            success: true,
            message: `${employeeLabel(target)} is already restored. Nothing to do.`,
            code: "NOT_ARCHIVED",
        };
    }

    await recordArchiveEvent({
        employeeId: id,
        actorEmail,
        actorRole,
        label: employeeLabel(target),
        archivedAt: now,
        action: "EMPLOYEE_RESTORED",
        detail: { previouslyArchivedAt: target.deletedAt ? target.deletedAt.toISOString() : null },
    });

    revalidateEmployeeSurfaces();

    return {
        success: true,
        message: `${employeeLabel(target)} restored and is visible in the employee directory again.`,
        code: "RESTORED",
    };
}

/**
 * PURGE — genuine erasure, for a data-protection request.
 *
 * Deliberately kept, because deleting the capability would be worse than the
 * defect it fixes: without it, an erasure request has no honest answer and gets
 * satisfied by someone with a database console.
 *
 * THREE INDEPENDENT GATES, all of which must open:
 *
 *   1. `requireSuperAdmin`. `employees.delete` is an ADMIN capability; purge is
 *      SUPER_ADMIN only, and `requireSuperAdmin` checks the ROLE rather than the
 *      resolved permission set — so a per-user `allow` override cannot grant it.
 *      That is a strictly higher bar than archive, on purpose.
 *   2. `confirm === true` plus a written `reason`. An erasure is the one
 *      operation here that cannot be undone and cannot be reconstructed from a
 *      backup without a restore window; it is made deliberate.
 *   3. `purgeEligibility`. Refused before the retention period has elapsed, and
 *      refused for a row that is not archived at all — purge is not a shortcut
 *      around archive.
 *
 * IT STILL MAY NOT SUCCEED, AND THAT IS REPORTED RATHER THAN PAPERED OVER.
 * `AuditLog_employeeId_fkey` and `LeaveRequest_employeeId_fkey` are ON DELETE
 * RESTRICT, so the database will refuse the delete for any employee with
 * history — which is every real one. This action does NOT cascade-delete audit
 * rows to force it through. Doing so would destroy the very trail the retention
 * rule exists to protect, and it would do so silently, in a function whose
 * entire purpose is to be irreversible. When the FK blocks, the caller is told
 * exactly which relation blocked and what a human has to decide.
 *
 * The security event is written BEFORE the delete attempt, and into
 * `SecurityAuditLog` (no foreign key), so the fact that a purge was attempted
 * survives even if the attempt removes the employee it refers to.
 */
export async function purgeEmployee(input: {
    id: string;
    /** Written justification, retained in the security log. */
    reason: string;
    /** Must be literally `true`. There is no default. */
    confirm?: boolean;
}): Promise<EmployeeActionResult> {
    const id = input?.id ?? "";
    const reason = (input?.reason ?? "").trim();

    let actorEmail = "unknown";
    let actorRole = "unknown";
    try {
        const user = await requireSuperAdmin("employee.record.purge");
        actorEmail = user.email;
        actorRole = user.role;
    } catch {
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail,
            actorRole,
            outcome: "DENIED",
            requestMethod: "SERVER_ACTION",
            detail: { target: "purgeEmployee", required: "SUPER_ADMIN", employeeRecordId: id },
        });
        return {
            success: false,
            message: "Erasing an employee record requires SUPER_ADMIN. This action is not available to you.",
            code: "PERMISSION_DENIED",
        };
    }

    if (input?.confirm !== true) {
        return {
            success: false,
            message: "Purge was not confirmed. Nothing was deleted.",
            code: "CONFIRMATION_REQUIRED",
        };
    }

    if (reason.length < 10) {
        return {
            success: false,
            message: "An erasure needs a written reason of at least 10 characters. Nothing was deleted.",
            code: "REASON_REQUIRED",
        };
    }

    const now = new Date();

    let target: {
        id: string;
        employeeCode: string | null;
        firstName: string;
        lastName: string;
        deletedAt: Date | null;
        currentStatus: string;
    } | null;
    try {
        target = await prisma.employee.findUnique({
            where: { id },
            select: {
                id: true,
                employeeCode: true,
                firstName: true,
                lastName: true,
                deletedAt: true,
                currentStatus: true,
            },
        });
    } catch (error) {
        console.error("[PURGE_EMPLOYEE_READ_FAILED]", error);
        return { success: false, message: "Could not read the employee record.", code: "READ_FAILED" };
    }

    if (!target) {
        return { success: false, message: "Employee not found.", code: "NOT_FOUND" };
    }

    let retentionYears: number;
    try {
        retentionYears = activeRetentionYears();
    } catch (error) {
        if (error instanceof RetentionPolicyError) {
            // A misconfigured retention value must never be read as "expired".
            return { success: false, message: error.message, code: error.code };
        }
        throw error;
    }

    const eligibility = purgeEligibility(
        {
            deletedAt: target.deletedAt,
            // No trustworthy "end of the employment relationship" column exists on
            // Employee, so the archive timestamp starts the clock — the later and
            // therefore more conservative of the two available starts.
            relationshipEndedAt: null,
        },
        now,
        retentionYears
    );

    if (!eligibility.eligible) {
        return {
            success: false,
            message: eligibility.reason ?? "This record is not eligible for erasure.",
            code: eligibility.code ?? "NOT_ELIGIBLE",
        };
    }

    // Written FIRST, and to the table with no foreign key, so the attempt is on
    // the record even if the delete below succeeds and takes the employee with
    // it.
    await logSecurityEvent({
        action: SECURITY_ACTION.USER_DISABLED,
        actorEmail,
        actorRole,
        target: `employee-record:${id}`,
        requestMethod: "SERVER_ACTION",
        detail: {
            lifecycleAction: "EMPLOYEE_PURGE_ATTEMPTED",
            employeeCode: target.employeeCode,
            archivedAt: target.deletedAt ? target.deletedAt.toISOString() : null,
            currentStatus: target.currentStatus,
            retentionYears: eligibility.retentionYears,
            purgeAfterIso: eligibility.purgeAfterIso,
            reason,
        },
    });

    try {
        // The ONLY `prisma.employee.delete` in this module. Everything else that
        // removes an employee from view is an update.
        await prisma.employee.delete({ where: { id } });
    } catch (error) {
        console.error("[PURGE_EMPLOYEE_BLOCKED]", error);
        const code = extractPrismaErrorCode(error);
        return {
            success: false,
            message:
                code === "P2003"
                    ? "The database refused the erasure because other records still reference this employee " +
                      "(audit log or leave history, which are retained on purpose). Nothing was deleted. Removing " +
                      "those rows is a separate decision and must be made by a human, not by this action."
                    : "The database refused the erasure. Nothing was deleted.",
            code: code ?? "PURGE_BLOCKED",
        };
    }

    revalidateEmployeeSurfaces();

    return {
        success: true,
        message: `${employeeLabel(target)} was permanently erased. Retention of ${eligibility.retentionYears} year(s) had elapsed.`,
        code: "PURGED",
    };
}

function extractPrismaErrorCode(error: unknown): string | null {
    if (error && typeof error === "object" && "code" in error) {
        const code = (error as { code?: unknown }).code;
        if (typeof code === "string") return code;
    }
    return null;
}

/**
 * RETRIEVAL — the other half of the requirement, and the direction that is easy
 * to forget. An archive is only safe if the record can be found again.
 *
 * Guarded by `EMPLOYEES_VIEW`, which HR and ADMIN both hold. Reading an
 * archived record is strictly less privileged than archiving one (that needs
 * `EMPLOYEES_DELETE`), and HR must be able to see archived staff to answer
 * "is this person still on file?" — otherwise the archive becomes a place
 * records go to be lost.
 *
 * Each row carries its own purge eligibility, so the retention rule is visible
 * to whoever reviews the archive rather than being a constant buried in a
 * server action.
 *
 * The UI for this lives in `app/employees/**`, which another agent owns; until
 * that surface is built, this server action is the retrieval path.
 */
export async function getArchivedEmployees(): Promise<
    { success: true; data: EmployeeArchiveRow[] } | { success: false; data: []; message: string }
> {
    try {
        await requirePermission(PERMISSIONS.EMPLOYEES_VIEW);
    } catch {
        return { success: false, data: [], message: "You do not have permission to view archived employees." };
    }

    const now = new Date();
    let retentionYears: number;
    try {
        retentionYears = activeRetentionYears();
    } catch (error) {
        if (error instanceof RetentionPolicyError) {
            return { success: false, data: [], message: error.message };
        }
        throw error;
    }

    try {
        const rows = await prisma.employee.findMany({
            where: { deletedAt: { not: null } },
            orderBy: { deletedAt: "desc" },
            select: {
                id: true,
                employeeCode: true,
                firstName: true,
                lastName: true,
                email: true,
                department: true,
                designation: true,
                currentStatus: true,
                isActive: true,
                deletedAt: true,
            },
        });

        return {
            success: true,
            data: rows.map((row) => {
                const eligibility = purgeEligibility({ deletedAt: row.deletedAt }, now, retentionYears);
                // The `where` clause guarantees a non-null tombstone, but Prisma's
                // generated type cannot know that and types it `Date | null`.
                // Narrowed explicitly rather than cast — and destructured rather
                // than spread, because `...row` re-widens the property back to
                // `Date | null` no matter what was proven about it.
                const { deletedAt, ...rest } = row;
                if (deletedAt === null) {
                    throw new Error("Archived-employee query returned a row with no deletedAt; the where clause is wrong.");
                }
                return {
                    ...rest,
                    deletedAt,
                    purgeAfterIso: eligibility.purgeAfterIso,
                    purgeEligible: eligibility.eligible,
                    daysUntilPurgeEligible: eligibility.daysRemaining,
                    retentionYears: eligibility.retentionYears,
                };
            }),
        };
    } catch (error) {
        console.error("[ARCHIVED_EMPLOYEES_READ_FAILED]", error);
        return { success: false, data: [], message: "Could not load archived employees." };
    }
}

export interface EmployeeArchiveRow {
    id: string;
    employeeCode: string | null;
    firstName: string;
    lastName: string;
    email: string;
    department: string | null;
    designation: string | null;
    currentStatus: string;
    isActive: boolean;
    deletedAt: Date;
    purgeAfterIso: string | null;
    purgeEligible: boolean;
    daysUntilPurgeEligible: number;
    retentionYears: number;
}

/**
 * DEPRECATED ALIAS — kept only because `app/employees/employee-list.tsx:338`
 * calls `deleteEmployee(id)` and that file is owned by another agent.
 *
 * It performs an ARCHIVE. The name is misleading and should be changed at the
 * call site to `archiveEmployee` with matching confirmation copy ("Archive this
 * employee?" rather than "delete"), which is a change to a file this task does
 * not own. Reported, not applied.
 *
 * This alias is also why `tests/lifecycle-consistency.test.ts` fails: that test
 * asserts `prisma.employee.delete(` appears in the `deleteEmployee` body, which
 * was a deliberate pin on the defect. It is the correct test to break.
 */
export async function deleteEmployee(id: string): Promise<EmployeeActionResult> {
    return archiveEmployee(id);
}

export async function getActiveEmployees() {
    let permitted = true;
    try {
        await requirePermission(PERMISSIONS.EMPLOYEES_VIEW);
    } catch {
        permitted = false;
    }
    if (!permitted) {
        return { success: false, data: [] };
    }
    try {
        const employees = await prisma.employee.findMany({
            // `isActive: true` alone is what already excluded archived rows; the
            // explicit tombstone filter is added so this query states the
            // invariant in the same terms as every other listing, and so a future
            // change to the `isActive` semantics cannot silently un-hide an
            // archived record.
            where: { isActive: true, ...NOT_ARCHIVED },
            select: { id: true, firstName: true, lastName: true, email: true, designation: true, employeeCode: true },
        });
        return { success: true, data: employees };
    } catch {
        return { success: false, data: [] };
    }
}
