import Link from "next/link";
import { ArrowLeft, UserRoundX } from "lucide-react";
import { requirePageUser } from "@/lib/auth/page-guard";
import { hasAnyPermission, PERMISSIONS } from "@/lib/auth/permissions";
import prisma from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExitCaseForm } from "@/components/exits/ExitCaseForm";
import { RouteExitCaseButton } from "@/components/exits/RouteExitCaseButton";

export const dynamic = "force-dynamic";

const dateLabel = (date: Date | null) => date
    ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "Not set";

export default async function ExitsPage() {
    const { user } = await requirePageUser();
    const canViewAll = hasAnyPermission(user.role, [PERMISSIONS.RESIGNATION_VIEW, PERMISSIONS.TERMINATION_VIEW]);
    const canManage = hasAnyPermission(user.role, [PERMISSIONS.TERMINATION_CREATE]);
    if (!canViewAll && !hasAnyPermission(user.role, [PERMISSIONS.RESIGNATION_CREATE])) {
        return <main className="mx-auto max-w-3xl p-6"><Card><CardHeader><CardTitle>Access unavailable</CardTitle><CardDescription>Your account does not have access to resignation requests.</CardDescription></CardHeader></Card></main>;
    }

    const [exitCases, employees] = await Promise.all([
        prisma.exitCase.findMany({
            where: canViewAll ? undefined : { employeeId: user.employeeId ?? "__no_employee_record__" },
            select: {
                id: true,
                type: true,
                status: true,
                reason: true,
                requestedAt: true,
                lastWorkingDate: true,
                resignationLetterName: true,
                employee: { select: { firstName: true, lastName: true, employeeCode: true, designation: true, department: true } },
            },
            orderBy: { requestedAt: "desc" },
            take: 100,
        }),
        canManage
            ? prisma.employee.findMany({
                where: { isActive: true },
                select: { id: true, firstName: true, lastName: true, employeeCode: true },
                orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
            })
            : Promise.resolve([]),
    ]);

    return (
        <main className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
            <Link href="/dashboard" className="inline-flex">
                <Button variant="ghost" className="gap-2 px-0 text-slate-600 hover:text-slate-950">
                    <ArrowLeft className="h-4 w-4" /> Dashboard
                </Button>
            </Link>

            <header className="rounded-3xl bg-gradient-to-br from-rose-950 via-slate-900 to-indigo-950 p-6 text-white shadow-lg sm:p-8">
                <div className="flex items-start gap-4">
                    <div className="rounded-2xl bg-white/10 p-3"><UserRoundX className="h-6 w-6" /></div>
                    <div>
                        <h1 className="text-2xl font-bold sm:text-3xl">Resignation & termination</h1>
                        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-rose-100 sm:text-base">
                            Submit a resignation request or, for HR and administrators, start an employee termination or contract-end case.
                        </p>
                    </div>
                </div>
            </header>

            <ExitCaseForm employees={employees} ownEmployeeId={user.employeeId ?? null} canManage={canManage} />

            <Card className="rounded-2xl border-slate-200 shadow-sm dark:border-slate-800">
                <CardHeader>
                    <CardTitle>{canViewAll ? "Exit cases" : "My resignation requests"}</CardTitle>
                    <CardDescription>
                        {canViewAll ? "Cases are kept in the employee history and move through the approval and clearance workflow." : "Track your request status here. HR must send it to the approval queue before it can be decided."}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {exitCases.length === 0 ? (
                        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">No exit cases have been submitted.</div>
                    ) : (
                        <div className="space-y-3">
                            {exitCases.map((exitCase) => (
                                <article key={exitCase.id} className="grid gap-4 rounded-xl border border-slate-200 p-4 dark:border-slate-800 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h2 className="font-semibold">{exitCase.employee.firstName} {exitCase.employee.lastName}</h2>
                                            <Badge variant="outline">{exitCase.type.replaceAll("_", " ")}</Badge>
                                            <Badge>{exitCase.status.replaceAll("_", " ")}</Badge>
                                        </div>
                                        <p className="mt-1 text-sm text-slate-500">{exitCase.employee.employeeCode} · {exitCase.employee.designation ?? "Role not set"} · {exitCase.employee.department ?? "Department not set"}</p>
                                        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{exitCase.reason || "No reason provided"}</p>
                                        <p className="mt-2 text-xs text-slate-500">Submitted {dateLabel(exitCase.requestedAt)} · Last working day: {dateLabel(exitCase.lastWorkingDate)}</p>
                                        {exitCase.resignationLetterName && (
                                            <a href={`/api/exits/${exitCase.id}/resignation-letter`} className="mt-2 inline-flex text-sm font-semibold text-indigo-600 underline-offset-4 hover:underline dark:text-indigo-300">
                                                Download letter: {exitCase.resignationLetterName}
                                            </a>
                                        )}
                                    </div>
                                    {canViewAll && canManage && exitCase.status === "REQUESTED" && (
                                        <RouteExitCaseButton exitCaseId={exitCase.id} />
                                    )}
                                    <Link href={`/exits/${exitCase.id}`} className="inline-flex">
                                        <Button type="button" size="sm" variant="outline">Open case workflow</Button>
                                    </Link>
                                </article>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </main>
    );
}
