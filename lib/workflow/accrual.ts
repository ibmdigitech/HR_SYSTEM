/**
 * Leave accrual (P1.3).
 *
 * Nothing about entitlement is hardcoded: it is driven entirely by
 * `LeaveAccrualPolicy` rows. A policy that does not exist produces no accrual.
 *
 * IDEMPOTENCY is a database guarantee, not an application check. Every accrual
 * writes a `LeaveAccrualRun` row whose unique key is
 * (employeeId, policyId, period). A second run for the same period therefore
 * fails on the constraint even if two processes run concurrently — which a
 * `findFirst`-then-`create` check could not prevent.
 *
 * Each employee is processed in its own transaction, so one bad employee cannot
 * roll back the whole run. The run reports per-employee outcomes.
 */

import prisma from "@/lib/prisma";

export type AccrualFrequency = "MONTHLY" | "ANNUAL" | "MANUAL";

/** `2026-01` for MONTHLY, `2026` for ANNUAL. */
export function periodFor(frequency: AccrualFrequency, reference: Date): string {
    const year = reference.getFullYear();
    if (frequency === "ANNUAL") return String(year);
    return `${year}-${String(reference.getMonth() + 1).padStart(2, "0")}`;
}

export interface AccrualOutcome {
    employeeId: string;
    leaveType: string;
    status: "APPLIED" | "SKIPPED";
    daysCredited: number;
    balanceAfter: number;
    reason?: string;
}

export interface AccrualRunResult {
    period: string;
    applied: number;
    skipped: number;
    failed: number;
    outcomes: AccrualOutcome[];
    /** True when nothing was written because the period was already processed. */
    alreadyProcessed: boolean;
}

export async function runLeaveAccrual(options: {
    /** Defaults to now. */
    reference?: Date;
    /** Restrict to one policy/leave type. */
    leaveType?: string;
    /** Restrict to one employee — used by the onboarding path. */
    employeeId?: string;
    /** 'yyyy-mm' or 'yyyy'. Inferred from the policy when omitted. */
    period?: string;
    actor?: { id: string; email: string; role: string };
}): Promise<AccrualRunResult> {
    const reference = options.reference ?? new Date();
    const year = reference.getFullYear();

    const policies = await prisma.leaveAccrualPolicy.findMany({
        where: {
            isActive: true,
            ...(options.leaveType ? { leaveType: options.leaveType } : {}),
            ...(options.period ? {} : { effectiveFrom: { lte: reference } }),
        },
        orderBy: [{ leaveType: "asc" }, { effectiveFrom: "desc" }],
    });

    if (policies.length === 0) {
        return {
            period: options.period ?? "—",
            applied: 0,
            skipped: 0,
            failed: 0,
            outcomes: [],
            alreadyProcessed: false,
        };
    }

    // Deduplicate to the newest policy per leave type.
    const byType = new Map<string, (typeof policies)[number]>();
    for (const policy of policies) {
        if (!byType.has(policy.leaveType)) byType.set(policy.leaveType, policy);
    }
    const active = [...byType.values()];

    const employees = await prisma.employee.findMany({
        where: {
            currentStatus: "ACTIVE",
            ...(options.employeeId ? { id: options.employeeId } : {}),
        },
        select: { id: true, department: true },
    });

    const outcomes: AccrualOutcome[] = [];
    let applied = 0;
    let skipped = 0;
    let failed = 0;
    let alreadyProcessed = false;

    for (const policy of active) {
        const period = options.period ?? periodFor(policy.accrualFrequency as AccrualFrequency, reference);

        for (const employee of employees) {
            try {
                // Per-employee transaction: an isolated failure must not abort
                // the run for everyone else.
                const result = await prisma.$transaction(async (tx) => {
                    // The unique key on (employeeId, policyId, period) is the
                    // real idempotency guarantee. This read exists only to
                    // produce a clear "already done" outcome.
                    const existing = await tx.leaveAccrualRun.findUnique({
                        where: {
                            employeeId_policyId_period: {
                                employeeId: employee.id,
                                policyId: policy.id,
                                period,
                            },
                        },
                        select: { id: true, status: true, balanceAfter: true },
                    });

                    if (existing) {
                        return {
                            status: "SKIPPED" as const,
                            daysCredited: 0,
                            balanceAfter: existing.balanceAfter,
                            reason: `Period ${period} already processed`,
                            alreadyProcessed: true,
                        };
                    }

                    const balance = await tx.leaveBalance.findFirst({
                        where: { employeeId: employee.id, leaveType: policy.leaveType, year },
                    });

                    const carryForward =
                        policy.carryForward && balance ? Math.max(0, balance.totalDays - balance.usedDays) : 0;
                    const credit = policy.accrualAmount || Math.round(policy.annualEntitlement / 12);

                    let totalDays: number;
                    if (balance) {
                        totalDays = balance.totalDays + credit;
                    } else {
                        totalDays = policy.annualEntitlement;
                    }

                    if (policy.maximumBalance != null && totalDays > policy.maximumBalance) {
                        totalDays = policy.maximumBalance;
                    }

                    if (balance) {
                        await tx.leaveBalance.update({
                            where: { id: balance.id },
                            data: { totalDays },
                        });
                    } else {
                        await tx.leaveBalance.create({
                            data: {
                                employeeId: employee.id,
                                leaveType: policy.leaveType,
                                totalDays,
                                usedDays: 0,
                                year,
                            },
                        });
                    }

                    const balanceAfter = totalDays - (balance?.usedDays ?? 0);

                    await tx.leaveAccrualRun.create({
                        data: {
                            policyId: policy.id,
                            employeeId: employee.id,
                            period,
                            daysCredited: credit,
                            daysCarried: carryForward,
                            balanceAfter,
                            status: "APPLIED",
                            createdBy: options.actor?.email ?? "system",
                        },
                    });

                    return {
                        status: "APPLIED" as const,
                        daysCredited: credit,
                        balanceAfter,
                        alreadyProcessed: false,
                    };
                });

                if (result.alreadyProcessed) alreadyProcessed = true;
                if (result.status === "APPLIED") applied++;
                else skipped++;

                outcomes.push({
                    employeeId: employee.id,
                    leaveType: policy.leaveType,
                    status: result.status,
                    daysCredited: result.daysCredited,
                    balanceAfter: result.balanceAfter,
                    reason: result.reason,
                });
            } catch (error) {
                failed++;
                outcomes.push({
                    employeeId: employee.id,
                    leaveType: policy.leaveType,
                    status: "SKIPPED",
                    daysCredited: 0,
                    balanceAfter: 0,
                    reason: error instanceof Error ? (error instanceof Error ? error.message : "Unknown error") : "unknown error",
                });
            }
        }
    }

    return {
        period: options.period ?? periodFor("MONTHLY", reference),
        applied,
        skipped,
        failed,
        outcomes,
        alreadyProcessed,
    };
}

/**
 * Provisions a new employee's first-year balances from the configured policies.
 * Called from onboarding. Idempotent: a second call for the same employee and
 * year does not double-credit.
 */
export async function provisionInitialBalances(employeeId: string, year: number): Promise<{
    created: number;
    skipped: number;
}> {
    const policies = await prisma.leaveAccrualPolicy.findMany({
        where: { isActive: true, effectiveFrom: { lte: new Date() } },
        orderBy: { effectiveFrom: "desc" },
    });

    if (policies.length === 0) {
        // No policy configured: create nothing rather than inventing an
        // entitlement. HR must configure a policy first.
        return { created: 0, skipped: 0 };
    }

    const byType = new Map<string, (typeof policies)[number]>();
    for (const policy of policies) {
        if (!byType.has(policy.leaveType)) byType.set(policy.leaveType, policy);
    }

    let created = 0;
    let skipped = 0;

    for (const policy of byType.values()) {
        const existing = await prisma.leaveBalance.findFirst({
            where: { employeeId, leaveType: policy.leaveType, year },
            select: { id: true },
        });
        if (existing) {
            skipped++;
            continue;
        }
        await prisma.leaveBalance.create({
            data: {
                employeeId,
                leaveType: policy.leaveType,
                totalDays: policy.annualEntitlement,
                usedDays: 0,
                year,
            },
        });
        created++;
    }

    return { created, skipped };
}
