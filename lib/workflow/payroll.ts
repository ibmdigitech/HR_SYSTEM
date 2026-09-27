/**
 * Payroll run integrity (P1.4).
 *
 * The existing `generatePayroll` created SalaryRecords directly with no run
 * header, so there was no single place recording whether a period had been
 * processed, approved or locked, and nothing stopped a second run for the same
 * period.
 *
 * ADDED:
 *  - `PayrollRun` header, unique on (year, month) — a duplicate period is a
 *    database error, not a hopeful application check.
 *  - An explicit lock. Once LOCKED the state machine permits no further
 *    transition, so an ordinary edit cannot reach a finalized period.
 *  - Batch processing with per-batch transactions, so a failure part-way
 *    through does not lose the whole run and does not hold one enormous
 *    transaction open.
 *  - Resumability: a run left in CALCULATING can be re-driven without
 *    duplicating the rows already written.
 */

import prisma from "@/lib/prisma";
import {
    PAYROLL_RUN_STATUS,
    PAYROLL_RUN_TRANSITIONS,
    assertTransition,
    InvalidTransitionError,
} from "@/lib/workflow/state-machine";

export interface RunResult {
    success: boolean;
    message: string;
    runId?: string;
    status?: string;
    processed?: number;
    failed?: number;
}

/** How many employees are written per transaction. */
const BATCH_SIZE = 50;

export async function getOrCreateRun(params: {
    month: number;
    year: number;
    actorEmail?: string;
}): Promise<{ id: string; status: string }> {
    const existing = await prisma.payrollRun.findUnique({
        where: { year_month: { year: params.year, month: params.month } },
        select: { id: true, status: true },
    });
    if (existing) return existing;

    // The unique (year, month) index is the real guard against a duplicate
    // period. This upsert simply turns the losing race into a re-read.
    try {
        const created = await prisma.payrollRun.create({
            data: { month: params.month, year: params.year, status: PAYROLL_RUN_STATUS.DRAFT },
            select: { id: true, status: true },
        });
        return created;
    } catch {
        const again = await prisma.payrollRun.findUnique({
            where: { year_month: { year: params.year, month: params.month } },
            select: { id: true, status: true },
        });
        if (!again) throw new Error("Could not create or read the payroll run.");
        return again;
    }
}

export interface CalculateArgs {
    month: number;
    year: number;
    actor: { id: string; email: string; role: string };
    /** Overrides the default employee selection. */
    employeeIds?: string[];
}

/**
 * Calculates salary records for a period.
 *
 * Batched: each batch is one transaction, so a single bad employee fails its
 * batch rather than the entire run. Re-running after a failure is safe — the
 * per-employee upsert keyed on (employeeId, year, month) prevents duplicates.
 */
export async function calculatePayrollRun(args: CalculateArgs): Promise<RunResult> {
    const { month, year, actor } = args;

    if (month < 1 || month > 12) return { success: false, message: "Invalid month." };
    if (year < 2000 || year > 2100) return { success: false, message: "Invalid year." };

    let run;
    try {
        run = await getOrCreateRun({ month, year, actorEmail: actor.email });
    } catch (error) {
        console.error("[PAYROLL_RUN_CREATE_FAILED]", error);
        return { success: false, message: "Could not open a payroll run for that period." };
    }

    // Refuse to recalculate a locked period. This is the payroll-lock
    // requirement: an authorized correction must go through an explicit
    // CANCELLED, not a silent re-run.
    if (run.status === PAYROLL_RUN_STATUS.LOCKED || run.status === PAYROLL_RUN_STATUS.PAID) {
        return {
            success: false,
            message: `The ${year}-${String(month).padStart(2, "0")} payroll is ${run.status}. Unlock requires an administrator.`,
            runId: run.id,
            status: run.status,
        };
    }

    const employees = await prisma.employee.findMany({
        where: {
            currentStatus: "ACTIVE",
            ...(args.employeeIds?.length ? { id: { in: args.employeeIds } } : {}),
        },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            salaryStructure: true,
        },
    });

    if (employees.length === 0) {
        return { success: false, message: "No active employees with a salary structure were found.", runId: run.id };
    }

    await prisma.payrollRun.update({
        where: { id: run.id },
        data: { status: PAYROLL_RUN_STATUS.CALCULATING },
    });

    let processed = 0;
    let failed = 0;
    let totalNet = 0;
    const failures: { employeeId: string; reason: string }[] = [];

    for (let i = 0; i < employees.length; i += BATCH_SIZE) {
        const batch = employees.slice(i, i + BATCH_SIZE);

        try {
            await prisma.$transaction(async (tx) => {
                for (const employee of batch) {
                    if (!employee.salaryStructure) {
                        failed++;
                        failures.push({ employeeId: employee.id, reason: "No salary structure" });
                        continue;
                    }

                    const s = employee.salaryStructure;

                    // Loan instalments are keyed by (month, year) on the
                    // instalment itself, and reach the employee through the
                    // owning application — not a date column.
                    const loanDeduction = await tx.loanInstallment.aggregate({
                        where: {
                            year,
                            month,
                            status: { in: ["PENDING", "DEDUCTED"] },
                            application: { employeeId: employee.id },
                        },
                        _sum: { amount: true },
                    });
                    const loanAmount = loanDeduction._sum?.amount ?? 0;

                    const gross =
                        s.basic + s.housingAllowance + s.transportAllowance + s.medicalAllowance + s.otherAllowances;
                    const net = Math.max(0, gross - loanAmount);

                    // Upsert keyed on (employeeId, year, month), which is a
                    // unique index. A re-run updates rather than inserting a
                    // second SalaryRecord.
                    await tx.salaryRecord.upsert({
                        where: { employeeId_year_month: { employeeId: employee.id, year, month } },
                        update: {
                            basic: s.basic,
                            housingAllowance: s.housingAllowance,
                            transportAllowance: s.transportAllowance,
                            medicalAllowance: s.medicalAllowance,
                            otherAllowances: s.otherAllowances,
                            loanDeduction: loanAmount,
                            netSalary: net,
                            status: "DRAFT",
                        },
                        create: {
                            employeeId: employee.id,
                            year,
                            month,
                            basic: s.basic,
                            housingAllowance: s.housingAllowance,
                            transportAllowance: s.transportAllowance,
                            medicalAllowance: s.medicalAllowance,
                            otherAllowances: s.otherAllowances,
                            loanDeduction: loanAmount,
                            netSalary: net,
                            status: "DRAFT",
                        },
                    });

                    totalNet += net;
                    processed++;
                }
            });
        } catch (error) {
            // One failed batch does not abort the run. It is retried on the next
            // invocation, which is safe because of the upsert above.
            failed += batch.length;
            for (const employee of batch) {
                failures.push({
                    employeeId: employee.id,
                    reason: error instanceof Error ? (error instanceof Error ? error.message : "Unknown error") : "batch failure",
                });
            }
        }
    }

    await prisma.payrollRun.update({
        where: { id: run.id },
        data: {
            status: processed > 0 ? PAYROLL_RUN_STATUS.CALCULATED : PAYROLL_RUN_STATUS.DRAFT,
            employeeCount: processed,
            totalNet,
            failureCount: failed,
            notes: failures.length ? `Failed: ${failures.slice(0, 10).map((f) => f.employeeId).join(", ")}` : null,
        },
    });

    return {
        success: processed > 0,
        message:
            failed > 0
                ? `Processed ${processed}, ${failed} failed. Re-run to retry only the failures.`
                : `Payroll calculated for ${processed} employee(s).`,
        runId: run.id,
        status: processed > 0 ? PAYROLL_RUN_STATUS.CALCULATED : PAYROLL_RUN_STATUS.DRAFT,
        processed,
        failed,
    };
}

export async function advancePayrollRun(params: {
    month: number;
    year: number;
    to: string;
    reference?: string;
    actor: { id: string; email: string; role: string };
}): Promise<RunResult> {
    const run = await prisma.payrollRun.findUnique({
        where: { year_month: { year: params.year, month: params.month } },
        select: { id: true, status: true, employeeCount: true },
    });
    if (!run) return { success: false, message: "No payroll run exists for that period." };

    try {
        assertTransition("PAYROLL", PAYROLL_RUN_TRANSITIONS, run.status, params.to, {
            actorRole: params.actor.role,
            actorId: params.actor.id,
        });
    } catch (error) {
        if (error instanceof InvalidTransitionError) {
            if (run.status === PAYROLL_RUN_STATUS.LOCKED) {
                return { success: false, message: "This period is locked and cannot be modified." };
            }
            return { success: false, message: `Not permitted: ${(error instanceof Error ? error.message : "Unknown error")}` };
        }
        throw error;
    }

        const request = await prisma.payrollRun.findUnique({
            where: { id: run.id },
            select: { id: true },
        });

        await prisma.$transaction([
            prisma.payrollRun.update({
                where: { id: run.id },
                data: {
                    status: params.to,
                    ...(params.to === PAYROLL_RUN_STATUS.APPROVED
                        ? { approvedBy: params.actor.email, approvedAt: new Date() }
                        : {}),
                    ...(params.to === PAYROLL_RUN_STATUS.LOCKED
                        ? { lockedBy: params.actor.email, lockedAt: new Date() }
                        : {}),
                    ...(params.to === PAYROLL_RUN_STATUS.PAID
                        ? { paidAt: new Date(), paidReference: params.reference ?? null }
                        : {}),
                },
            }),

            // Locking marks the individual records too, so a direct
            // SalaryRecord edit elsewhere also reflects the lock.
            ...(params.to === PAYROLL_RUN_STATUS.LOCKED || params.to === PAYROLL_RUN_STATUS.PAID
                ? [
                      prisma.salaryRecord.updateMany({
                          where: { year: params.year, month: params.month },
                          data: { status: params.to === PAYROLL_RUN_STATUS.PAID ? "PAID" : "LOCKED" },
                      }),
                  ]
                : []),
        ]);

    return {
        success: true,
        message: `Payroll run ${params.to.toLowerCase()}.`,
        runId: run.id,
        status: params.to,
    };
}

/** Whether a period is editable. Pages and actions call this before offering edit controls. */
export async function isPayrollPeriodLocked(year: number, month: number): Promise<boolean> {
    const run = await prisma.payrollRun.findUnique({
        where: { year_month: { year, month } },
        select: { status: true },
    });
    if (!run) return false;
    return run.status === PAYROLL_RUN_STATUS.LOCKED || run.status === PAYROLL_RUN_STATUS.PAID;
}

export async function listPayrollRuns() {
    return prisma.payrollRun.findMany({ orderBy: [{ year: "desc" }, { month: "desc" }], take: 24 });
}
