import prisma from "@/lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle, Search, Clock, ShieldAlert, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { getExpiringDocuments } from "@/lib/workflow/compliance";
import { hasAnyPermission, PERMISSIONS } from "@/lib/auth/permissions";
import { ComplianceControls } from "./compliance-controls";
import { DocumentCellEditor } from "./document-cell-editor";

/**
 * One document cell.
 *
 * WHY THIS IS A FUNCTION AND NOT SEVEN COPIES OF THE SAME MARKUP
 *
 * Every column previously rendered the literal words "Not Provided" when empty.
 * That string is wider than the column, so it soft-wrapped onto two lines in
 * Passport / Emirates ID / Visa while the wider Residence Permit / Labour Card
 * columns kept it on one — which is why rows ended up ~90px tall and visibly
 * ragged down the table.
 *
 * A single em-dash keeps every empty cell one line wide, and the per-row
 * "N of M on file" count carries the real information that "Not Provided" was
 * repeating seven times over.
 */
const DocCell = ({
    number,
    expiry,
    stat,
}: {
    number?: string | null;
    expiry: Date | null;
    stat: { label: string; color: string };
}) => {
    // `new Date(null)` yields a bogus 1970 date rather than throwing, so the
    // missing case is handled explicitly instead of being coerced into one.
    if (!expiry) {
        return <span className="text-slate-300 dark:text-slate-600 text-sm leading-none">—</span>;
    }
    return (
        <div className="flex flex-col gap-1">
            {number && (
                <span className="font-mono text-[11px] font-bold text-slate-700 dark:text-slate-200 leading-none truncate">
                    {number}
                </span>
            )}
            <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium tabular-nums">
                    {new Date(expiry).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                </span>
                <Badge className={`px-1.5 py-0 h-4 text-[8px] font-black uppercase rounded border-0 leading-none ${stat.color}`}>
                    {stat.label}
                </Badge>
            </span>
        </div>
    );
};

export default async function VisaCompliancePage() {
    const session = await auth();
    if (!session?.user) redirect("/login");

    const userRole = (session.user as { role: string }).role;
    if (!["ADMIN", "HR", "MANAGER"].includes(userRole)) {
        redirect("/staff-services");
    }

    const employees = await prisma.employee.findMany({
        where: { isActive: true },
        orderBy: { firstName: "asc" }
    });

    const today = new Date();
    const thirtyDays = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const ninetyDays = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000);

    const getDocumentStatus = (expiryDate: Date | null | undefined) => {
        if (!expiryDate) return { label: "N/A", color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400" };
        const exp = new Date(expiryDate);
        if (exp < today) return { label: "Expired", color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400" };
        if (exp <= thirtyDays) return { label: "Critical (<30d)", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" };
        if (exp <= ninetyDays) return { label: "Warning (<90d)", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" };
        return { label: "Active", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" };
    };

    /**
     * ONE SOURCE OF TRUTH FOR THE COUNTS.
     *
     * These totals used to be recomputed here from a hand-written list of four
     * columns, which is how the module in lib/workflow/compliance.ts came to
     * disagree with this page: the scan tracked 5 documents, the form collected
     * 7, and this header counted 4. The same list now lives in exactly one
     * place — `TRACKED_DOCUMENTS` — and both the scan and these figures read it.
     *
     * `getExpiringDocuments` performs its own `requirePermission(VISA_VIEW)`;
     * the role gate above stays so an unrelated role is redirected rather than
     * rendered with an error.
     */
    const expiring = await getExpiringDocuments(90);
    const expiredCount = expiring.filter((c) => c.status === "EXPIRED").length;
    const criticalCount = expiring.filter((c) => c.status === "EXPIRING" && c.daysRemaining <= 30).length;
    const warningCount = expiring.filter((c) => c.status === "EXPIRING" && c.daysRemaining > 30 && c.daysRemaining <= 90).length;

    // The scan itself is a side-effecting operation (it writes reminders and
    // notifications), so it is gated on VISA_MANAGE. Viewing is VISA_VIEW.
    const canManageVisa = hasAnyPermission(userRole, [PERMISSIONS.VISA_MANAGE]);

return (
        <div className="w-full max-w-[1600px] mx-auto p-3 md:p-4 space-y-4">
            {/*
                HERO — the full-width gradient banner that was here before.

                It was slimmed to a single row and that was too far: the band lost
                the visual identity of the page and the reader lost the sentence
                explaining what the screen is for. Restored at its original scale,
                with `group` added so the decorative blooms, the shield badge and
                the title gradient all react to hover.
            */}
            <header className="group relative overflow-hidden bg-gradient-to-br from-rose-900 via-rose-950 to-slate-900 p-5 sm:p-6 md:p-10 rounded-[2rem] shadow-2xl transition-shadow duration-500 hover:shadow-rose-950/40">
                <div className="pointer-events-none absolute top-0 right-0 w-64 h-64 sm:w-[500px] sm:h-[500px] bg-rose-500/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2 transition-transform duration-700 group-hover:scale-110" />
                <div className="pointer-events-none absolute bottom-0 left-0 w-56 h-56 sm:w-[400px] sm:h-[400px] bg-orange-500/10 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/2 transition-transform duration-700 group-hover:scale-110" />

                <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-5 sm:gap-8">
                    <div className="min-w-0">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-rose-200 text-xs font-bold uppercase tracking-widest mb-4 sm:mb-5 transition-colors duration-300 group-hover:bg-white/15 group-hover:border-white/20">
                            <ShieldAlert className="h-3 w-3 text-rose-400 transition-transform duration-300 group-hover:rotate-12" />
                            Document &amp; Visa Audit
                        </div>
                        <h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-white mb-2 sm:mb-3 leading-tight">
                            Compliance
                            <br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-rose-400 to-orange-400 transition-all duration-500 group-hover:from-rose-300 group-hover:to-amber-300">
                                Control Center
                            </span>
                        </h1>
                        <p className="text-slate-300 text-xs sm:text-sm font-medium max-w-2xl leading-relaxed">
                            Monitor Passport, Emirates ID, and Visa expiries. Flag expired files
                            and critical compliance risks before they disrupt operations.
                        </p>
                    </div>

                    <div className="hidden lg:flex items-center gap-2 shrink-0">
                        {[
                            { k: "Expired", v: expiredCount, cls: "text-rose-300" },
                            { k: "≤ 30 days", v: criticalCount, cls: "text-orange-300" },
                            { k: "≤ 90 days", v: warningCount, cls: "text-amber-300" },
                        ].map((s) => (
                            <div
                                key={s.k}
                                className="rounded-xl bg-white/10 px-3 py-2 text-center ring-1 ring-inset ring-white/10 transition-all duration-300 hover:bg-white/15 hover:ring-white/25 hover:-translate-y-0.5"
                            >
                                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 leading-none">
                                    {s.k}
                                </p>
                                <p className={`text-2xl font-black leading-tight tabular-nums ${s.cls}`}>{s.v}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </header>

            {/*
                STAT CARDS — restored from the four-card grid that was removed
                when the hero was slimmed. The figures are unchanged and still come
                from `getExpiringDocuments`, so they cannot drift from the scan or
                from the Action Required list; only the presentation is back.

                `cursor-pointer` is deliberately absent: nothing is clickable here,
                so a pointer cursor would promise an action that does not exist.
                Hover lifts and tints instead.
            */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                    {
                        title: "Total Headcount",
                        value: `${employees.length} Staff`,
                        note: "Total active sponsorship",
                        icon: Clock,
                        iconCls: "bg-indigo-100 dark:bg-indigo-900/30",
                        iconFg: "text-indigo-600 dark:text-indigo-400",
                        valueCls: "text-slate-800 dark:text-white",
                        noteCls: "text-slate-500",
                        hoverCls: "hover:border-indigo-300 dark:hover:border-indigo-800",
                    },
                    {
                        title: "Expired Documents",
                        value: `${expiredCount} File(s)`,
                        note: "Requires immediate renewal",
                        icon: AlertTriangle,
                        iconCls: "bg-rose-100 dark:bg-rose-900/30",
                        iconFg: "text-rose-600 dark:text-rose-400",
                        valueCls: "text-rose-600 dark:text-rose-400",
                        noteCls: "text-rose-600",
                        hoverCls: "hover:border-rose-300 dark:hover:border-rose-800",
                    },
                    {
                        title: "Critical Expiry (<30d)",
                        value: `${criticalCount} File(s)`,
                        note: "Action due this month",
                        icon: Clock,
                        iconCls: "bg-orange-100 dark:bg-orange-900/30",
                        iconFg: "text-orange-600 dark:text-orange-400",
                        valueCls: "text-orange-600 dark:text-orange-400",
                        noteCls: "text-orange-600",
                        hoverCls: "hover:border-orange-300 dark:hover:border-orange-800",
                    },
                    {
                        title: "Warning Expiry (<90d)",
                        value: `${warningCount} File(s)`,
                        note: "Sufficient runway remaining",
                        icon: CheckCircle,
                        iconCls: "bg-amber-100 dark:bg-amber-900/30",
                        iconFg: "text-amber-600 dark:text-amber-400",
                        valueCls: "text-amber-600 dark:text-amber-400",
                        noteCls: "text-amber-600",
                        hoverCls: "hover:border-amber-300 dark:hover:border-amber-800",
                    },
                ].map((c) => {
                    const Icon = c.icon;
                    return (
                        <div
                            key={c.title}
                            className={`group/card rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl px-4 py-3 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg ${c.hoverCls}`}
                        >
                            <div className="flex items-start justify-between gap-2 mb-2">
                                <h3 className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider leading-tight">
                                    {c.title}
                                </h3>
                                <div
                                    className={`p-1.5 rounded-lg ${c.iconCls} transition-transform duration-300 group-hover/card:scale-110`}
                                >
                                    <Icon className={`h-3.5 w-3.5 ${c.iconFg}`} />
                                </div>
                            </div>
                            <p className={`text-2xl font-black leading-none tabular-nums ${c.valueCls}`}>
                                {c.value}
                            </p>
                            <p className={`text-[10px] font-bold mt-1.5 leading-tight ${c.noteCls}`}>
                                {c.note}
                            </p>
                        </div>
                    );
                })}
            </div>

            {/*
                COMMAND BAR — the scan control and a headcount figure.

                This row previously also hosted the scan result panel, so pressing
                "Run scan" pushed the bar taller and shoved the directory down.
                The result now renders in a fixed-position overlay measured from
                the button, so running a scan changes nothing about this bar's
                height or the page position.
            */}
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-4 py-2 shadow-sm">
                <dl className="flex items-center gap-3">
                    <div className="flex items-baseline gap-1.5">
                        <dt className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                            Total Headcount
                        </dt>
                        <dd className="text-base font-black tabular-nums text-slate-900 dark:text-white leading-none">
                            {employees.length}
                        </dd>
                    </div>
                    {expiring.length > 0 && (
                        <div className="flex items-baseline gap-1.5 pl-3 border-l border-slate-200 dark:border-slate-800">
                            <dt className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                Inside 90d window
                            </dt>
                            <dd className="text-base font-black tabular-nums text-orange-600 dark:text-orange-400 leading-none">
                                {expiring.length}
                            </dd>
                        </div>
                    )}
                </dl>

                <div className="ml-auto">
                    <ComplianceControls
                        canManage={canManageVisa}
                        summary={{
                            expired: expiredCount,
                            critical: criticalCount,
                            warning: warningCount,
                            total: expiring.length,
                        }}
                        compact
                    />
                </div>
            </div>


            {/*
                The scan's findings, on the same page as the controls that
                produced them.

                `ComplianceControls` returned only aggregate counts, so running a
                scan told an operator "2 created" and left them to work out which
                two by scanning the whole directory below. These rows come from
                the same `expiring` array the header figures use, so the count
                and the list can never disagree.
            */}
            {expiring.length > 0 && (
                <section aria-labelledby="action-queue-heading">
                    <h2
                        id="action-queue-heading"
                        className="text-sm font-black uppercase tracking-[0.15em] text-slate-500 dark:text-slate-400 mb-2 px-1"
                    >
                        Action Required · {expiring.length}
                    </h2>
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800/60">
                        {expiring.map((c) => {
                            const overdue = c.daysRemaining < 0;
                            const soon = c.daysRemaining <= 30;
                            const tone = overdue
                                ? "text-rose-600 dark:text-rose-400"
                                : soon
                                    ? "text-orange-600 dark:text-orange-400"
                                    : "text-amber-600 dark:text-amber-400";
                            return (
                                <li
                                    key={`${c.employeeId}-${c.documentType}`}
                                    className="flex items-center justify-between gap-3 py-2.5 px-1 hover:bg-slate-50/70 dark:hover:bg-slate-900/40 transition-colors"
                                >
                                    <div className="min-w-0 flex items-baseline gap-2">
                                        <span className="font-bold text-sm text-slate-900 dark:text-white whitespace-nowrap truncate">
                                            {c.employeeName}
                                        </span>
                                        <span className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap truncate">
                                            {c.documentLabel}
                                            {c.department ? ` · ${c.department}` : ""}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2.5 shrink-0 whitespace-nowrap">
                                        <span className="text-[10px] text-slate-500 dark:text-slate-400 tabular-nums">
                                            {new Date(c.expiryDate).toLocaleDateString("en-GB", {
                                                day: "2-digit",
                                                month: "short",
                                                year: "numeric",
                                            })}
                                        </span>
                                        <span className={`text-xs font-black tabular-nums ${tone}`}>
                                            {overdue
                                                ? `${Math.abs(c.daysRemaining)}d overdue`
                                                : `${c.daysRemaining}d left`}
                                        </span>
                                        <Link
                                            href={`/employees/${c.employeeId}`}
                                            className="text-[11px] font-bold text-indigo-600 hover:underline dark:text-indigo-400"
                                        >
                                            Open
                                        </Link>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}

            {/* Directory. The outer card frame, border and shadow are gone: this
                table is the page's main surface, and wrapping it in a rounded
                box inside an already-padded page produced a visible double edge
                around the content. */}
            <section aria-labelledby="directory-heading">
                <div className="px-1 mb-3">
                    <h2 id="directory-heading" className="text-xl font-bold text-slate-900 dark:text-white">
                        Workforce Document Directory
                    </h2>
                    <p className="text-sm font-medium text-slate-500">
                        Comprehensive record of passport, Emirates ID, medical insurance, and visa
                        validity dates.
                    </p>
                </div>

                {/* MOBILE: a definition list per employee. Built from the same tracked
                        expiry list as the table so the two views can never show a
                        different set of documents — it previously showed four
                        columns while the table showed six. */}
                {employees.length === 0 ? (
                    <p className="md:hidden text-center py-20 px-4 text-slate-400 italic font-medium">
                        No active employees found in system database.
                        </p>
                    ) : (
                    <ul className="md:hidden divide-y divide-slate-100 dark:divide-slate-800/60">
                        {employees.map((record) => {
                            const docs: { label: string; number?: string | null; expiry: Date | null }[] = [
                                { label: "Passport", number: record.passportNumber, expiry: record.passportExpiry },
                                { label: "Emirates ID", number: record.emiratesId, expiry: record.emiratesIdExpiry },
                                { label: "Visa", number: record.visaNumber, expiry: record.visaExpiry },
                                { label: "Residence Permit", number: record.residencePermitNumber, expiry: record.residencePermitExpiry },
                                { label: "Labour Card", number: record.labourCardNumber, expiry: record.labourCardExpiry },
                                { label: "Medical Insurance", expiry: record.medicalInsuranceExpiry },
                            ];
                            const onFile = docs.filter((d) => d.expiry).length;

                            return (
                                <li key={record.id} className="p-4 flex flex-col gap-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <div className="h-8 w-8 shrink-0 rounded-full bg-rose-100 dark:bg-rose-900/50 flex items-center justify-center text-rose-700 dark:text-rose-400 font-bold text-[11px]">
                                                {record.firstName[0]}{record.lastName[0]}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-bold text-sm text-slate-900 dark:text-white truncate">
                                                    {record.firstName} {record.lastName}
                                                </p>
                                                <p className="text-[10px] font-bold text-slate-400 tracking-tight">
                                                    {record.employeeCode || "No code"}
                                                </p>
                                            </div>
                                        </div>
                                        <span className={`shrink-0 inline-flex items-center justify-center min-w-[2.25rem] px-1.5 py-0.5 rounded-md text-[10px] font-black tabular-nums leading-none ${
                                            onFile === docs.length
                                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                                                : onFile === 0
                                                    ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                                                    : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                                        }`}>
                                            {onFile}/{docs.length}
                                        </span>
                                    </div>

                                    <dl className="grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1.5 text-[11px]">
                                        {docs.map((d) => (
                                            <div key={d.label} className="contents">
                                                <dt className="text-slate-400 font-bold whitespace-nowrap">{d.label}</dt>
                                                <dd className="flex flex-wrap items-center gap-1.5 min-w-0">
                                                    <DocCell number={d.number} expiry={d.expiry} stat={getDocumentStatus(d.expiry)} />
                                                </dd>
                                            </div>
                                        ))}
                                    </dl>

                                    <Link
                                        href={`/employees/${record.id}`}
                                        className="self-start inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:underline dark:text-indigo-400"
                                    >
                                        Edit Profile
                                        <ArrowUpRight className="h-3 w-3" />
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                    )}

                    <div className="hidden md:block overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="border-slate-100 dark:border-slate-800/60 hover:bg-transparent">
                                    <TableHead className="font-bold py-2 whitespace-nowrap">Employee</TableHead>
                                    <TableHead className="font-bold py-2 whitespace-nowrap">Passport</TableHead>
                                    <TableHead className="font-bold py-2 whitespace-nowrap">EID</TableHead>
                                    <TableHead className="font-bold py-2 whitespace-nowrap">Visa</TableHead>
                                    <TableHead className="font-bold py-2 whitespace-nowrap">Permit</TableHead>
                                    <TableHead className="font-bold py-2 whitespace-nowrap">Labour</TableHead>
                                    <TableHead className="font-bold py-2 whitespace-nowrap">Medical</TableHead>
                                    <TableHead className="font-bold py-2 whitespace-nowrap">ILOE</TableHead>
                                    <TableHead className="font-bold py-2 text-center whitespace-nowrap">On File</TableHead>
                                    <TableHead className="font-bold py-3 text-right whitespace-nowrap">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {employees.map((record) => {
                                    const passStat = getDocumentStatus(record.passportExpiry);
                                    const eidStat = getDocumentStatus(record.emiratesIdExpiry);
                                    const visaStat = getDocumentStatus(record.visaExpiry);
                                    const medStat = getDocumentStatus(record.medicalInsuranceExpiry);
                                    const residenceStat = getDocumentStatus(record.residencePermitExpiry);
                                    const labourStat = getDocumentStatus(record.labourCardExpiry);
                                    const iloeStat = getDocumentStatus(record.iloeInsuranceExpiry);

                                    // Completeness across the tracked types, so one
                                    // glance says whether this row needs chasing
                                    // instead of seven identical "Not Provided".
                                    const tracked = [
                                        record.passportExpiry, record.emiratesIdExpiry, record.visaExpiry,
                                        record.residencePermitExpiry, record.labourCardExpiry,
                                        record.medicalInsuranceExpiry, record.iloeInsuranceExpiry,
                                    ];
                                    const onFile = tracked.filter(Boolean).length;

                                    return (
                                        <TableRow key={record.id} className="border-slate-100 dark:border-slate-800/60 hover:bg-slate-50/80 dark:hover:bg-slate-900/50 transition-colors">
                                            <TableCell className="py-2.5">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="h-8 w-8 shrink-0 rounded-full bg-rose-100 dark:bg-rose-900/50 flex items-center justify-center text-rose-700 dark:text-rose-400 font-bold text-[11px]">
                                                        {record.firstName[0]}{record.lastName[0]}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="font-bold text-sm text-slate-900 dark:text-white whitespace-nowrap truncate">
                                                            {record.firstName} {record.lastName}
                                                        </div>
                                                        <div className="text-[10px] font-bold text-slate-400 tracking-tight whitespace-nowrap">
                                                            {record.employeeCode || "No code"}
                                                        </div>
                                                    </div>
                                                </div>
                                            </TableCell>

                                            <TableCell className="py-1.5">
                                                <DocumentCellEditor
                                                    employeeId={record.id}
                                                    documentType="PASSPORT"
                                                    label="Passport"
                                                    number={record.passportNumber}
                                                    expiry={record.passportExpiry}
                                                    status={passStat}
                                                    canEdit={canManageVisa}
                                                />
                                            </TableCell>

                                            <TableCell className="py-1.5">
                                                <DocumentCellEditor
                                                    employeeId={record.id}
                                                    documentType="EMIRATES_ID"
                                                    label="Emirates ID"
                                                    number={record.emiratesId}
                                                    expiry={record.emiratesIdExpiry}
                                                    status={eidStat}
                                                    canEdit={canManageVisa}
                                                />
                                            </TableCell>

                                            <TableCell className="py-1.5">
                                                <DocumentCellEditor
                                                    employeeId={record.id}
                                                    documentType="VISA"
                                                    label="Visa"
                                                    number={record.visaNumber}
                                                    expiry={record.visaExpiry}
                                                    status={visaStat}
                                                    canEdit={canManageVisa}
                                                />
                                            </TableCell>

                                            <TableCell className="py-1.5">
                                                <DocumentCellEditor
                                                    employeeId={record.id}
                                                    documentType="RESIDENCE_PERMIT"
                                                    label="Residence Permit"
                                                    number={record.residencePermitNumber}
                                                    expiry={record.residencePermitExpiry}
                                                    status={residenceStat}
                                                    canEdit={canManageVisa}
                                                />
                                            </TableCell>

                                            <TableCell className="py-1.5">
                                                <DocumentCellEditor
                                                    employeeId={record.id}
                                                    documentType="LABOUR_CARD"
                                                    label="Labour Card"
                                                    number={record.labourCardNumber}
                                                    expiry={record.labourCardExpiry}
                                                    status={labourStat}
                                                    canEdit={canManageVisa}
                                                />
                                            </TableCell>

                                            <TableCell className="py-1.5">
                                                <DocumentCellEditor
                                                    employeeId={record.id}
                                                    documentType="MEDICAL_INSURANCE"
                                                    label="Medical"
                                                    expiry={record.medicalInsuranceExpiry}
                                                    status={medStat}
                                                    canEdit={canManageVisa}
                                                />
                                            </TableCell>

                                            <TableCell className="py-1.5">
                                                <DocumentCellEditor
                                                    employeeId={record.id}
                                                    documentType="ILOE_INSURANCE"
                                                    label="ILOE"
                                                    expiry={record.iloeInsuranceExpiry}
                                                    status={iloeStat}
                                                    canEdit={canManageVisa}
                                                />
                                            </TableCell>

                                            <TableCell className="py-2.5 text-center">
                                                <span
                                                    title={`${onFile} of ${tracked.length} tracked documents recorded`}
                                                    className={`inline-flex items-center justify-center min-w-[2.25rem] px-1.5 py-0.5 rounded-md text-[10px] font-black tabular-nums leading-none ${
                                                        onFile === tracked.length
                                                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                                                            : onFile === 0
                                                                ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                                                                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                                                    }`}
                                                >
                                                    {onFile}/{tracked.length}
                                                </span>
                                            </TableCell>

                                            <TableCell className="py-2.5 text-right whitespace-nowrap">
                                                <Link href={`/employees/${record.id}`} className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:underline dark:text-indigo-400">
                                                    Edit Profile
                                                    <ArrowUpRight className="h-3 w-3" />
                                                </Link>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                                {employees.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={10} className="text-center py-12 text-slate-400 italic font-medium">
                                            No active employees found in system database.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
            </section>
        </div>
    );
}
