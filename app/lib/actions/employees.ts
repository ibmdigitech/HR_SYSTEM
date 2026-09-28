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
import { requirePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";
import { issueActivationToken } from "@/lib/workflow/credentials";
import { ensureChecklist, notifyManagerOfNewHire } from "@/lib/workflow/onboarding";

/** Shared result shape so the client can render field-level or form-level errors. */
export type EmployeeActionResult = {
    success: boolean;
    message: string;
    fieldErrors?: Record<string, string>;
    /** P1.1: one-time activation link for the new account. Shown once, never stored. */
    activation?: { token: string; expiresAt: string };
    activationError?: string;
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

export async function deleteEmployee(id: string): Promise<EmployeeActionResult> {
    try {
        await requirePermission(PERMISSIONS.EMPLOYEES_DELETE);
    } catch {
        return { success: false, message: "You do not have permission to delete employees." };
    }
    try {
        await prisma.employee.delete({ where: { id } });
        revalidatePath("/employees");
        return { success: true, message: "Employee deleted" };
    } catch (error) {
        return { success: false, message: "Error deleting employee" };
    }
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
            where: { isActive: true },
            select: { id: true, firstName: true, lastName: true, email: true, designation: true, employeeCode: true },
        });
        return { success: true, data: employees };
    } catch {
        return { success: false, data: [] };
    }
}
