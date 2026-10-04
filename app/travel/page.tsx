import Link from "next/link";
import { ArrowLeft, Plane, ShieldCheck } from "lucide-react";
import { requirePageUser } from "@/lib/auth/page-guard";
import { PERMISSIONS, hasPermission } from "@/lib/auth/permissions";
import { scopeEmployeeWhere } from "@/lib/auth/scope";
import prisma from "@/lib/prisma";
import type { Prisma } from "@/prisma/generated/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    getEntitlementRegister,
    getEntitlementSummary,
    getTravelDocumentMap,
    toAmountNumber,
} from "@/lib/workflow/business-travel";
import { TravelRequestForm } from "./travel-request-form";
import { TravelDecisionButtons } from "./travel-decision-buttons";
import { EntitlementControls } from "./entitlement-controls";
import { TravelDocumentUpload } from "./travel-document-upload";
import { TravelAmountGrant } from "./travel-amount-grant";

export const dynamic = "force-dynamic";

const day = (value: Date | string | null | undefined): string =>
    value
        ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
        : "--";

const money = (value: number): string =>
    new Intl.NumberFormat("en-AE", { maximumFractionDigits: 2 }).format(value);

/** ISO `yyyy-MM-dd` in local time, matching what `DateField` submits. */
function isoDay(value: Date): string {
    return [
        String(value.getFullYear()).padStart(4, "0"),
        String(value.getMonth() + 1).padStart(2, "0"),
        String(value.getDate()).padStart(2, "0"),
    ].join("-");
}

/**
 * Visa validity, shown in the same row as the entitlement.
 *
 * THE USER ASKED FOR THESE TO BE READ TOGETHER. The entitlement window is derived
 * from the visa date, so splitting the two across different pages means the
 * operator cannot tell whether a window has already rolled over after a renewal.
 * Days remaining is relative to today rather than to the window, because an
 * expired visa is the fact worth acting on.
 */
function visaCell(visaNumber: string | null, visaExpiry: Date | null) {
    if (!visaExpiry) {
        return <span className="text-sm text-slate-400">Not recorded</span>;
    }
    const days = Math.ceil((visaExpiry.getTime() - Date.now()) / 86_400_000);
    const tone =
        days < 0
            ? "text-rose-600 dark:text-rose-400"
            : days <= 30
              ? "text-orange-600 dark:text-orange-400"
              : days <= 90
                ? "text-amber-600 dark:text-amber-400"
                : "text-emerald-600 dark:text-emerald-400";
    return (
        <div className="flex flex-col gap-0.5">
            <span className="whitespace-nowrap text-sm tabular-nums">{day(visaExpiry)}</span>
            <span className={`whitespace-nowrap text-[11px] font-bold tabular-nums ${tone}`}>
                {visaNumber ? `${visaNumber} · ` : ""}
                {days < 0 ? `${Math.abs(days)}d overdue` : `${days}d left`}
            </span>
        </div>
    );
}

const STATUS_TONE: Record<string, string> = {
    REQUESTED: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
    PENDING_APPROVAL: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
    APPROVED: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
    COMPLETED: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
    REJECTED: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200",
    CANCELLED: "border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
};

/** A request that still holds a ticket, so the queue total matches the register. */
const OPEN_STATUSES: readonly string[] = ["REQUESTED", "PENDING_APPROVAL", "APPROVED"];

const OPEN_STATUS_SET = new Set<string>(OPEN_STATUSES);

export default async function BusinessTravelPage() {
    const { user, subject } = await requirePageUser();

    const canDecide = hasPermission(user.role, PERMISSIONS.TRAVEL_APPROVE);
    const canRequestForOthers = hasPermission(user.role, PERMISSIONS.TRAVEL_REQUEST_ANY);
    const canManageEntitlement = hasPermission(user.role, PERMISSIONS.TRAVEL_ENTITLEMENT_MANAGE);
    const seesWholeRegister = hasPermission(user.role, PERMISSIONS.TRAVEL_VIEW_ALL);

    const [register, requests, ownSummary, employees] = await Promise.all([
        getEntitlementRegister(subject),
        prisma.businessTravelRequest.findMany({
            where: scopeEmployeeWhere(subject) as Prisma.BusinessTravelRequestWhereInput,
            select: {
                id: true,
                status: true,
                purpose: true,
                destinationCountry: true,
                destinationCity: true,
                departureDate: true,
                returnDate: true,
                travelClass: true,
                ticketCostBorneBy: true,
                estimatedCost: true,
                approvedAmount: true,
                budgetVariance: true,
                amountGrantedBy: true,
                amountGrantedAt: true,
                entitlementWindowKey: true,
                requestedBy: true,
                createdAt: true,
                employeeId: true,
                employee: {
                    select: { firstName: true, lastName: true, employeeCode: true },
                },
            },
            orderBy: { createdAt: "desc" },
            take: 100,
        }),
        user.employeeId ? getEntitlementSummary(user.employeeId) : Promise.resolve(null),
        canRequestForOthers
            ? prisma.employee.findMany({
                  where: { isActive: true, deletedAt: null },
                  select: { id: true, firstName: true, lastName: true, employeeCode: true },
                  orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
              })
            : Promise.resolve([]),
    ]);

    const entitledEmployees = register.filter((row) => row.contractedTickets > 0);
    const windowsUsed = new Set(register.map((row) => row.windowKey)).size;
    // Budget headroom per employee, so each request row can show what is left of
    // that employee's window without a second query per row.
    const budgetByEmployee = new Map(register.map((row) => [row.employeeId, row]));

    // One query for every request's documents rather than one per row: the list
    // can hold a hundred requests.
    const documentsByRequest = await getTravelDocumentMap(subject, requests);

    return (
        <main className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
            <Link href="/dashboard" className="inline-flex">
                <Button variant="ghost" className="gap-2 px-0 text-slate-600 hover:text-slate-950">
                    <ArrowLeft className="h-4 w-4" /> Dashboard
                </Button>
            </Link>

            <header className="rounded-3xl bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-950 p-6 text-white shadow-lg sm:p-8">
                <div className="flex flex-wrap items-start gap-4">
                    <div className="rounded-2xl bg-white/10 p-3">
                        <Plane className="h-6 w-6" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h1 className="text-2xl font-bold sm:text-3xl">Business travel &amp; air tickets</h1>
                        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">
                            Some employees are entitled to one or two return air tickets a year. The
                            entitlement year follows the visa renewal date, not the calendar year, so
                            the window and the visa are shown together below.
                        </p>
                    </div>
                    <dl className="flex flex-wrap gap-4 sm:gap-6">
                        <div>
                            <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Entitled
                            </dt>
                            <dd className="text-xl font-bold tabular-nums">{entitledEmployees.length}</dd>
                        </div>
                        <div>
                            <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Tickets left
                            </dt>
                            <dd className="text-xl font-bold tabular-nums text-emerald-300">
                                {register.reduce((sum, row) => sum + row.remaining, 0)}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Open requests
                            </dt>
                            <dd className="text-xl font-bold tabular-nums text-amber-300">
                                {requests.filter((r) => OPEN_STATUS_SET.has(r.status)).length}
                            </dd>
                        </div>
                    </dl>
                </div>
            </header>

            {/*
                THE ENTITLEMENT REGISTER.

                `entitled`, `used`, `remaining` and the window sit in the same row as
                the visa expiry. A separate "visa" page and a separate "travel" page
                would have hidden exactly the thing HR needs to check: whether the
                window has already rolled over since the last renewal.
            */}
            <Card className="rounded-2xl border-slate-200 shadow-sm dark:border-slate-800">
                <CardHeader>
                    <CardTitle>
                        {seesWholeRegister ? "Air ticket entitlement register" : "My air ticket entitlement"}
                    </CardTitle>
                    <CardDescription>
                        {windowsUsed} entitlement window{windowsUsed === 1 ? "" : "s"} in view, because each
                        employee&apos;s window starts on their own visa date. A request consumes a ticket
                        from the window its departure date falls in, not from the calendar year, and the
                        same window carries the annual money budget beside it.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {register.length === 0 ? (
                        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">
                            No active employee records are in your scope.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Employee</TableHead>
                                            <TableHead className="text-center">Per year</TableHead>
                                            <TableHead className="text-center">Used</TableHead>
                                            <TableHead className="text-center">In flight</TableHead>
                                            <TableHead className="text-center">Remaining</TableHead>
                                            <TableHead className="text-right">Annual budget</TableHead>
                                            <TableHead className="text-right">Granted</TableHead>
                                            <TableHead className="text-right">Budget left</TableHead>
                                            <TableHead>Class</TableHead>
                                            <TableHead>Entitlement window</TableHead>
                                            <TableHead>Anchor</TableHead>
                                            <TableHead>Visa expiry</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {register.map((row) => (
                                            <TableRow key={row.employeeId}>
                                                <TableCell>
                                                    <div className="font-semibold">{row.employeeName}</div>
                                                    <div className="text-xs text-slate-500">
                                                        {row.employeeCode ?? "No code"}
                                                        {row.department ? ` · ${row.department}` : ""}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-center font-bold tabular-nums">
                                                    {row.entitled}
                                                </TableCell>
                                                <TableCell className="text-center tabular-nums text-slate-600 dark:text-slate-300">
                                                    {row.used}
                                                </TableCell>
                                                <TableCell className="text-center tabular-nums text-slate-600 dark:text-slate-300">
                                                    {row.committed}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <span
                                                        className={`inline-flex min-w-[2.25rem] justify-center rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums ${
                                                            row.remaining === 0
                                                                ? "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                                                                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                                                        }`}
                                                    >
                                                        {row.remaining}
                                                    </span>
                                                </TableCell>
                                                {/* The budget is a MONEY cap and is deliberately
                                                    not folded into the ticket columns above:
                                                    one is a count, the other is currency, and
                                                    an operator comparing them needs to know which
                                                    is which. Null is shown as "no cap", never as
                                                    zero — a zero cap and an unset one are
                                                    different states. */}
                                                <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">
                                                    {row.annualTravelBudget === null ? (
                                                        <span className="text-xs text-amber-600 dark:text-amber-400">
                                                            No cap
                                                        </span>
                                                    ) : (
                                                        `AED ${money(row.annualTravelBudget)}`
                                                    )}
                                                </TableCell>
                                                <TableCell className="whitespace-nowrap text-right text-sm tabular-nums text-slate-600 dark:text-slate-300">
                                                    {row.budgetGranted > 0 ? `AED ${money(row.budgetGranted)}` : "--"}
                                                </TableCell>
                                                <TableCell className="whitespace-nowrap text-right text-sm">
                                                    {row.budgetRemaining === null ? (
                                                        <span className="text-xs text-slate-400">--</span>
                                                    ) : (
                                                        <span
                                                            className={`font-bold tabular-nums ${
                                                                row.budgetRemaining <= 0
                                                                    ? "text-rose-600 dark:text-rose-400"
                                                                    : "text-emerald-600 dark:text-emerald-400"
                                                            }`}
                                                        >
                                                            AED {money(row.budgetRemaining)}
                                                        </span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="whitespace-nowrap text-sm">
                                                    {row.travelClass ? row.travelClass.replaceAll("_", " ") : "--"}
                                                </TableCell>
                                                <TableCell className="whitespace-nowrap text-sm tabular-nums">
                                                    {day(row.windowStart)} to {day(row.windowEnd)}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="whitespace-nowrap text-sm tabular-nums">
                                                            {day(row.anchor)}
                                                        </span>
                                                        {!row.anchorIsVisaLinked && (
                                                            <span className="whitespace-nowrap text-[11px] font-bold text-amber-600 dark:text-amber-400">
                                                                No visa date: using the calendar year
                                                            </span>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    {visaCell(row.visaNumber, row.visaExpiry)}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>

                            {ownSummary && (
                                <p className="text-xs text-slate-500">
                                    Your window is {ownSummary.windowLabel}. It is{" "}
                                    {ownSummary.anchorIsVisaLinked
                                        ? "anchored to your visa date."
                                        : "not linked to a visa date yet, so it currently follows the calendar year. HR can set the anchor below."}
                                </p>
                            )}

                            {canManageEntitlement && (
                                <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
                                    <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                                        Set an entitlement
                                    </p>
                                    {register
                                        .filter((row) => row.contractedTickets > 0 || row.anchorIsVisaLinked)
                                        .map((row) => (
                                            <EntitlementControls
                                                key={row.employeeId}
                                                employeeId={row.employeeId}
                                                employeeName={row.employeeName}
                                                entitledPerYear={row.contractedTickets}
                                                travelClass={row.travelClass}
                                                // Only an EXPLICIT anchor is editable here. A
                                                // VISA_ISSUE_DATE anchor is derived from the visa
                                                // record the compliance feature owns, so
                                                // pre-filling the editor with it and saving would
                                                // silently freeze a value that must follow the
                                                // next renewal. It is shown as the fallback
                                                // instead.
                                                anchorDate={null}
                                                anchorFallback={
                                                    row.anchorSource === "VISA_ISSUE_DATE"
                                                        ? isoDay(row.anchor)
                                                        : null
                                                }
                                                annualBudget={row.annualTravelBudget}
                                            />
                                        ))}
                                    {register.length === 0 && (
                                        <p className="text-sm text-slate-500">
                                            No employees are in scope, so there is nothing to configure.
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            <TravelRequestForm
                employees={employees}
                ownEmployeeId={user.employeeId}
                canRequestForOthers={canRequestForOthers}
                entitledCount={ownSummary?.remaining ?? 0}
            />

            <Card className="rounded-2xl border-slate-200 shadow-sm dark:border-slate-800">
                <CardHeader>
                    <CardTitle>
                        {seesWholeRegister ? "Travel requests" : "My travel requests"}
                    </CardTitle>
                    <CardDescription>
                        A request is decided by someone other than the person who raised it, and the
                        ticket is counted as used only when it is recorded as issued. Amount must be
                        granted and documents verified before this trip can be approved. A boarding
                        pass must be attached before a trip can be recorded as flown.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {requests.length === 0 ? (
                        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">
                            No business travel has been requested yet.
                        </div>
                    ) : (
                        <ul className="space-y-3">
                            {requests.map((request) => {
                                const isOwn = request.employeeId === user.employeeId;
                                const documents = documentsByRequest.get(request.id) ?? [];
                                const missingBoardingPass =
                                    request.status === "APPROVED" &&
                                    !documents.some((doc) => doc.kind === "BOARDING_PASS");
                                const unverifiedDocuments = documents.filter(
                                    (doc) => doc.verifiedAt === null
                                );
                                const budget = budgetByEmployee.get(request.employeeId);
                                // `Prisma.Decimal` is a class instance and cannot cross the
                                // server/client boundary, so every money value becomes a
                                // plain number here, once, at the edge.
                                const approvedAmount = toAmountNumber(request.approvedAmount);
                                const budgetVariance = toAmountNumber(request.budgetVariance);
                                const awaitingReview =
                                    request.status === "REQUESTED" || request.status === "PENDING_APPROVAL";
                                // What is still standing between this request and approval.
                                const approvalBlockers = [
                                    approvedAmount === null ? "no approved amount granted" : null,
                                    unverifiedDocuments.length > 0
                                        ? `${unverifiedDocuments.length} filed document(s) not verified`
                                        : null,
                                ].filter((item): item is string => item !== null);
                                return (
                                    <li
                                        key={request.id}
                                        className="grid gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800 md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
                                    >
                                        <div className="min-w-0 space-y-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h3 className="font-semibold">{request.purpose}</h3>
                                                <Badge
                                                    variant="outline"
                                                    className={STATUS_TONE[request.status] ?? ""}
                                                >
                                                    {request.status.replaceAll("_", " ")}
                                                </Badge>
                                                <Badge variant="outline">
                                                    {request.travelClass.replaceAll("_", " ")}
                                                </Badge>
                                                <Badge variant="outline">
                                                    {request.ticketCostBorneBy === "COMPANY"
                                                        ? "Company pays"
                                                        : "Employee pays"}
                                                </Badge>
                                            </div>
                                            <p className="text-sm text-slate-600 dark:text-slate-300">
                                                {request.employee.firstName} {request.employee.lastName}
                                                {request.employee.employeeCode
                                                    ? ` · ${request.employee.employeeCode}`
                                                    : ""}{" "}
                                                &rarr;{" "}
                                                {[request.destinationCity, request.destinationCountry]
                                                    .filter(Boolean)
                                                    .join(", ")}
                                            </p>
                                            <p className="text-xs text-slate-500">
                                                Departs {day(request.departureDate)}
                                                {request.returnDate ? ` · returns ${day(request.returnDate)}` : ""} ·
                                                estimate AED {money(request.estimatedCost)}
                                                {request.entitlementWindowKey
                                                    ? ` · window from ${day(request.entitlementWindowKey)}`
                                                    : ""}
                                            </p>
                                            {/* Estimate, granted amount and the difference
                                                between them, in one line. HR sees what moved
                                                without doing arithmetic on two columns. */}
                                            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                                                {approvedAmount === null ? (
                                                    <span className="text-amber-700 dark:text-amber-400">
                                                        No amount granted — estimate AED {money(request.estimatedCost)}
                                                    </span>
                                                ) : (
                                                    <>
                                                        Approved AED {money(approvedAmount)}
                                                        {request.amountGrantedBy
                                                            ? ` by ${request.amountGrantedBy}`
                                                            : ""}
                                                        {request.amountGrantedAt
                                                            ? ` · ${day(request.amountGrantedAt)}`
                                                            : ""}
                                                        {budgetVariance !== null && budgetVariance !== 0 ? (
                                                            <span
                                                                className={
                                                                    budgetVariance < 0
                                                                        ? "text-emerald-600 dark:text-emerald-400"
                                                                        : "text-amber-600 dark:text-amber-400"
                                                                }
                                                            >
                                                                {" "}
                                                                ({budgetVariance < 0 ? "-" : "+"} AED{" "}
                                                                {money(Math.abs(budgetVariance))} vs estimate)
                                                            </span>
                                                        ) : null}
                                                    </>
                                                )}
                                                {budget?.annualTravelBudget !== null && budget?.annualTravelBudget !== undefined
                                                    ? ` · AED ${money(budget.budgetRemaining ?? 0)} of the annual budget left`
                                                    : ""}
                                            </p>
                                            {/* The rule is stated on the row, not only in the
                                                server's refusal: a refusal at completion time
                                                after the traveller has already flown is the
                                                expensive place to learn it. */}
                                            {missingBoardingPass && (
                                                <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                                                    A boarding pass is required before this trip can be
                                                    recorded as flown.
                                                </p>
                                            )}
                                            <TravelAmountGrant
                                                requestId={request.id}
                                                estimatedCost={request.estimatedCost}
                                                approvedAmount={approvedAmount}
                                                budgetVariance={budgetVariance}
                                                grantedBy={request.amountGrantedBy}
                                                budgetRemaining={budget?.budgetRemaining ?? null}
                                                annualBudget={budget?.annualTravelBudget ?? null}
                                                canGrant={canDecide && awaitingReview}
                                            />
                                            <TravelDocumentUpload
                                                requestId={request.id}
                                                status={request.status}
                                                documents={documents}
                                                canUpload={isOwn || canDecide}
                                                canVerify={canDecide}
                                            />
                                        </div>
<TravelDecisionButtons
                                                requestId={request.id}
                                                status={request.status}
                                                canDecide={canDecide}
                                                isOwnRequest={isOwn}
                                                approvalBlockers={approvalBlockers}
                                            />
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </main>
    );
}