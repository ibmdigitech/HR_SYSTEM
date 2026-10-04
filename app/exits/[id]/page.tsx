import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePageUser } from "@/lib/auth/page-guard";
import { hasAnyPermission, hasPermission, PERMISSIONS } from "@/lib/auth/permissions";
import prisma from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExitCaseWorkflow } from "@/components/exits/ExitCaseWorkflow";
import { EXIT_STATUS_VIEW, EXIT_TYPE_VIEW, UNKNOWN_STATUS } from "../status-view";

export const dynamic = "force-dynamic";

function dateLabel(date: Date | null): string {
    return date ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Not set";
}

export default async function ExitCasePage({ params }: { params: Promise<{ id: string }> }) {
    const { user } = await requirePageUser();
    const { id } = await params;
    const canViewAll = hasAnyPermission(user.role, [PERMISSIONS.RESIGNATION_VIEW, PERMISSIONS.TERMINATION_VIEW]);
    const exitCase = await prisma.exitCase.findUnique({
        where: { id },
        select: {
            id: true,
            employeeId: true,
            type: true,
            status: true,
            reason: true,
            requestedAt: true,
            effectiveDate: true,
            lastWorkingDate: true,
            noticePeriodDays: true,
            decisionNote: true,
            decidedAt: true,
            resignationLetterName: true,
            employee: {
                select: {
                    firstName: true,
                    lastName: true,
                    employeeCode: true,
                    designation: true,
                    department: true,
                    lifecycle: true,
                    isActive: true,
                },
            },
            interview: { select: { rating: true, wouldRejoin: true, comments: true, conductedAt: true } },
        },
    });
    if (!exitCase || (!canViewAll && exitCase.employeeId !== user.employeeId)) notFound();

    const offboarding = await prisma.offboardingRequest.findFirst({
        where: {
            employeeId: exitCase.employeeId,
            status: { notIn: ["COMPLETED", "CANCELLED"] },
        },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            status: true,
            checklist: {
                select: { id: true, label: true, category: true, required: true, status: true, notes: true },
                orderBy: { createdAt: "asc" },
            },
            settlement: {
                select: {
                    status: true,
                    pendingSalaryDays: true,
                    pendingSalaryAmount: true,
                    leaveEncashmentDays: true,
                    leaveEncashmentAmount: true,
                    loanDeductions: true,
                    advanceDeductions: true,
                    otherDeductions: true,
                    otherAdditions: true,
                    gratuityAmount: true,
                    finalAmount: true,
                    calculationNotes: true,
                    paidReference: true,
                },
            },
        },
    });

    const status = EXIT_STATUS_VIEW[exitCase.status] ?? { ...UNKNOWN_STATUS, label: exitCase.status };
    const type = EXIT_TYPE_VIEW[exitCase.type]?.label ?? exitCase.type;
    const isAdmin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";
    const canRecordPayment = hasPermission(user.role, PERMISSIONS.PAYROLL_SETTLE) &&
        hasPermission(user.role, PERMISSIONS.EXIT_SETTLEMENT);
    const payoutDestination = canRecordPayment
        ? await prisma.employee.findUnique({
            where: { id: exitCase.employeeId },
            select: { bankName: true, accountNumber: true, iban: true },
        })
        : null;

    return (
        <main className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-8">
            <Link href="/exits" className="inline-flex">
                <Button variant="ghost" className="gap-2 px-0"><ArrowLeft className="h-4 w-4" /> Exit cases</Button>
            </Link>

            <Card className="rounded-2xl">
                <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                        <CardTitle>{exitCase.employee.firstName} {exitCase.employee.lastName}</CardTitle>
                        <Badge variant="outline">{type}</Badge>
                        <Badge className={status.badge}>{status.label}</Badge>
                    </div>
                    <CardDescription>{exitCase.employee.employeeCode ?? "No employee code"} · {exitCase.employee.designation ?? "Role not set"} · {exitCase.employee.department ?? "Department not set"}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
                    <p><span className="font-semibold">Reason:</span> {exitCase.reason ?? "Not provided"}</p>
                    <p><span className="font-semibold">Submitted:</span> {dateLabel(exitCase.requestedAt)}</p>
                    <p><span className="font-semibold">Effective date:</span> {dateLabel(exitCase.effectiveDate)}</p>
                    <p><span className="font-semibold">Last working day:</span> {dateLabel(exitCase.lastWorkingDate)}</p>
                    <p><span className="font-semibold">Agreed notice:</span> {exitCase.noticePeriodDays === null ? "Not set" : `${exitCase.noticePeriodDays} days`}</p>
                    <p><span className="font-semibold">Approval:</span> {exitCase.decidedAt ? dateLabel(exitCase.decidedAt) : "Pending"}</p>
                    {exitCase.decisionNote && <p className="sm:col-span-2"><span className="font-semibold">Decision note:</span> {exitCase.decisionNote}</p>}
                    {exitCase.resignationLetterName && (
                        <a className="font-semibold text-indigo-600 underline dark:text-indigo-300" href={`/api/exits/${exitCase.id}/resignation-letter`}>Download resignation letter: {exitCase.resignationLetterName}</a>
                    )}
                </CardContent>
            </Card>

            <Card className="rounded-2xl">
                <CardHeader>
                    <CardTitle>Procedure and settlement</CardTitle>
                    <CardDescription>{status.note}</CardDescription>
                </CardHeader>
                <CardContent>
                    <ExitCaseWorkflow
                        exitCase={{ id: exitCase.id, type: exitCase.type, status: exitCase.status, lastWorkingDate: exitCase.lastWorkingDate, noticePeriodDays: exitCase.noticePeriodDays }}
                        offboarding={offboarding}
                        payoutDestination={payoutDestination}
                        permissions={{
                            advanceApproval: hasAnyPermission(user.role, [PERMISSIONS.RESIGNATION_APPROVE, PERMISSIONS.TERMINATION_APPROVE]),
                            clearance: hasPermission(user.role, PERMISSIONS.EXIT_CLEARANCE),
                            interview: hasPermission(user.role, PERMISSIONS.EXIT_INTERVIEW),
                            prepareSettlement: hasPermission(user.role, PERMISSIONS.EXIT_SETTLEMENT) && hasPermission(user.role, PERMISSIONS.PAYROLL_VIEW),
                            approveSettlement: isAdmin,
                            paySettlement: canRecordPayment,
                            complete: hasPermission(user.role, PERMISSIONS.EXIT_COMPLETE),
                        }}
                    />
                </CardContent>
            </Card>

            {exitCase.interview && (
                <Card className="rounded-2xl">
                    <CardHeader><CardTitle>Exit interview record</CardTitle></CardHeader>
                    <CardContent className="space-y-2 text-sm">
                        <p>Recorded {dateLabel(exitCase.interview.conductedAt)} · Rating: {exitCase.interview.rating ?? "Not scored"} · Would rejoin: {exitCase.interview.wouldRejoin === null ? "Not asked" : exitCase.interview.wouldRejoin ? "Yes" : "No"}</p>
                        {exitCase.interview.comments && <p className="whitespace-pre-wrap">{exitCase.interview.comments}</p>}
                    </CardContent>
                </Card>
            )}
        </main>
    );
}
