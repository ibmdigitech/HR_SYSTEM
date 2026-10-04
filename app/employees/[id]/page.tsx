import Link from "next/link";
import {
    ArrowLeft,
    Briefcase,
    Building2,
    Calendar,
    CheckCircle2,
    Mail,
    MapPin,
    Phone,
    ShieldAlert,
    ShieldCheck,
    UserCircle,
    Users,
    Wallet,
} from "lucide-react";

import prisma from "@/lib/prisma";
import { requirePageUser } from "@/lib/auth/page-guard";
import { PERMISSIONS, resolvePermissions } from "@/lib/auth/permissions";
import { scopeEmployeeWhere } from "@/lib/auth/scope";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";
import { classifyEmployeeState } from "@/lib/workflow/lifecycle-consistency";
import { PageHero } from "@/components/common/PageHero";
import { EmployeeAvatar } from "../employee-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PROFILE_SELECT, FULL_SELECT } from "./employee-select";
import { LIFECYCLE_STAGE, UNKNOWN_STAGE } from "./lifecycle-stage";

/**
 * /employees/[id] — the employee profile the master directory never had a link
 * to (UI gap 8.8).
 *
 * AUTHORIZATION HAPPENS BEFORE ANY RENDER AND BEFORE ANY QUERY
 *  - No session            -> `requirePageUser` redirects to /login.
 *  - No capability         -> an explicit unauthorized state; nothing is
 *                             queried, so the page cannot confirm that a
 *                             particular employee exists.
 *  - Out of scope / absent -> an explicit not-found state. The organisational
 *                             predicate is part of the `where` clause, so the
 *                             two cases are indistinguishable to the viewer —
 *                             see the note in `app/api/employees/[id]/route.ts`.
 *
 * LIFECYCLE IS THE HEADLINE, NOT `currentStatus`
 * The directory badge is `Employee.currentStatus`, which the entry/edit form
 * and offboarding both write WITHOUT advancing the stage, so it is the
 * non-authoritative column. `Employee.lifecycle` is the one the CHECK
 * constraint and `LIFECYCLE_TRANSITIONS` govern, so it is what this page leads
 * with. `currentStatus` and `isActive` appear only inside the consistency
 * panel, and only as evidence of a disagreement — this page introduces no
 * fourth status badge and no new state column.
 */

export const dynamic = "force-dynamic";

function formatDate(value: Date | string | null | undefined): string {
    if (!value) return "—";
    const date = typeof value === "string" ? new Date(value) : value;
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function Section({
    title,
    icon: Icon,
    children,
}: {
    title: string;
    icon: typeof Users;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4 sm:p-5">
            <h2 className="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500">
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {title}
            </h2>
            {children}
        </section>
    );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="min-w-0">
            <dt className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</dt>
            <dd className="mt-0.5 truncate text-sm font-bold text-slate-800 dark:text-slate-100">{value ?? "—"}</dd>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Terminal states                                                      */
/* ------------------------------------------------------------------ */

function Shell({ children }: { children: React.ReactNode }) {
    return (
        <div className="mx-auto w-full max-w-7xl space-y-8 p-4 md:p-8">
            <Link
                href="/employees"
                className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-indigo-600"
            >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Back to directory
            </Link>
            {children}
        </div>
    );
}

function UnauthorizedState() {
    return (
        <Shell>
            <div
                role="alert"
                className="rounded-[2rem] border-2 border-amber-300 bg-amber-50 p-8 text-center dark:border-amber-800 dark:bg-amber-950/40 md:p-12"
            >
                <ShieldAlert className="mx-auto mb-4 h-12 w-12 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <h1 className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white md:text-2xl">
                    Not authorized
                </h1>
                <p className="mx-auto mt-2 max-w-md text-sm font-medium text-slate-600 dark:text-slate-300">
                    Your role cannot open employee profiles. Nothing was loaded. If you believe this
                    is wrong, ask an administrator to review your access.
                </p>
                <Button
                    asChild
                    className="mt-6 h-11 rounded-xl bg-indigo-600 px-6 font-black uppercase text-xs tracking-widest hover:bg-indigo-700"
                >
                    <Link href="/dashboard">Back to dashboard</Link>
                </Button>
            </div>
        </Shell>
    );
}

function NotFoundState() {
    return (
        <Shell>
            {/* Deliberately not a 403. Whether the record is missing or simply
                outside the viewer's scope, the answer is the same — otherwise
                this page confirms who works for the company to anyone who can
                guess an id. */}
            <div
                role="status"
                className="rounded-[2rem] border-2 border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-950 md:p-12"
            >
                <UserCircle className="mx-auto mb-4 h-12 w-12 text-slate-300 dark:text-slate-700" aria-hidden="true" />
                <h1 className="text-xl font-black uppercase tracking-tight text-slate-900 dark:text-white md:text-2xl">
                    Employee not found
                </h1>
                <p className="mx-auto mt-2 max-w-md text-sm font-medium text-slate-500 dark:text-slate-400">
                    This record does not exist, or it is outside the part of the workforce your role
                    can see.
                </p>
                <Button
                    asChild
                    className="mt-6 h-11 rounded-xl bg-indigo-600 px-6 font-black uppercase text-xs tracking-widest hover:bg-indigo-700"
                >
                    <Link href="/employees">Back to directory</Link>
                </Button>
            </div>
        </Shell>
    );
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { user, subject } = await requirePageUser();

    const { permissions } = resolvePermissions(user.role);
    // Mirrors the API route exactly. `employees.view` is the directory
    // capability; `leave.view` is what makes a MANAGER (approves their team's
    // leave) and a STAFF member (reads their own record) legitimate readers of
    // a single profile. FINANCE holds neither and belongs on the payroll
    // surface, not here.
    const canReadProfile =
        permissions.has(PERMISSIONS.EMPLOYEES_VIEW) || permissions.has(PERMISSIONS.LEAVE_VIEW);

    if (!canReadProfile) {
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: user.email,
            actorRole: user.role,
            target: "page:employee-detail",
            outcome: "DENIED",
        });
        return <UnauthorizedState />;
    }

    const { id } = await params;
    const canViewRestricted = permissions.has(PERMISSIONS.EMPLOYEES_VIEW);

    // Scope is part of the query, not a filter applied afterwards. Hoisted so
    // it is visibly built once, before either branch runs.
    //
    // The requested id and the scope clause are ANDed rather than merged:
    // `scopeEmployeeWhere(subject, { id })` would, under SELF scope, return
    // `{ id: subject.employeeId }` and silently REPLACE the requested id, so
    // visiting another employee's URL would render your own record with a 200
    // instead of the not-found state. `AND` makes an out-of-scope id match no
    // row at all, which is what the guard comment above claims.
    const where = { AND: [{ id }, scopeEmployeeWhere(subject)] };

    // The discriminant is what lets TypeScript keep the two result shapes
    // apart. Without it the ternary collapses to one shape and the restricted
    // block below would either not typecheck or be forced behind a cast.
    const result = canViewRestricted
        ? {
              restricted: true as const,
              employee: await prisma.employee.findFirst({ where, select: FULL_SELECT }),
          }
        : {
              restricted: false as const,
              employee: await prisma.employee.findFirst({ where, select: PROFILE_SELECT }),
          };

    if (!result.employee) return <NotFoundState />;

    const { employee } = result;
    /** Null for a caller without `employees.view`; the whole-shape record for one with it. */
    const restricted = result.restricted ? result.employee : null;

    const stage = LIFECYCLE_STAGE[employee.lifecycle] ?? UNKNOWN_STAGE;
    const divergences = classifyEmployeeState({
        id: employee.id,
        employeeCode: employee.employeeCode,
        firstName: employee.firstName,
        lastName: employee.lastName,
        lifecycle: employee.lifecycle,
        currentStatus: employee.currentStatus,
        isActive: employee.isActive,
    });

    const documents: { label: string; expiry: Date | null }[] = [
        { label: "Passport", expiry: employee.passportExpiry },
        { label: "Emirates ID", expiry: employee.emiratesIdExpiry },
        { label: "Visa", expiry: employee.visaExpiry },
        { label: "Medical insurance", expiry: employee.medicalInsuranceExpiry },
        { label: "ILOE insurance", expiry: employee.iloeInsuranceExpiry },
    ];

    return (
        <div className="mx-auto w-full max-w-7xl space-y-8 p-4 md:p-8">
            <Link
                href="/employees"
                className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-slate-500 hover:text-indigo-600"
            >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Back to directory
            </Link>

            <PageHero
                eyebrow="Workforce Management"
                eyebrowIcon={Users}
                title={employee.firstName}
                accent={employee.lastName}
                description={[employee.designation, employee.department, employee.rollNumber]
                    .filter(Boolean)
                    .join(" · ")}
                actions={
                    <Link href="/employees">
                        <Button
                            variant="outline"
                            className="h-11 w-full gap-2 rounded-xl border-white/20 bg-white/5 px-6 font-bold text-sm text-white backdrop-blur-md hover:bg-white/10 sm:w-auto"
                        >
                            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                            Directory
                        </Button>
                    </Link>
                }
            />

            {/* ── Authoritative stage ─────────────────────────────────── */}
            <section
                aria-labelledby="lifecycle-heading"
                className="rounded-[2rem] border-2 border-indigo-200 bg-white p-5 shadow-sm dark:border-indigo-900 dark:bg-slate-950 sm:p-6"
            >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                        <h2
                            id="lifecycle-heading"
                            className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500"
                        >
                            <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            Lifecycle stage — authoritative
                        </h2>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Badge
                                className={`rounded-lg border-0 px-3 py-1 text-xs font-black uppercase tracking-widest ${stage.badge}`}
                            >
                                {employee.lifecycle.replace(/_/g, " ")}
                            </Badge>
                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                Employee.lifecycle
                            </span>
                        </div>
                        <p className="mt-2 text-sm font-medium text-slate-600 dark:text-slate-300">
                            {stage.note}
                        </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end">
                        <EmployeeAvatar
                            employee={employee}
                            className="h-16 w-16 sm:h-20 sm:w-20"
                            fallbackClassName="text-base sm:text-lg"
                        />
                        {employee.employeeCode && (
                            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                {employee.employeeCode}
                            </span>
                        )}
                    </div>
                </div>

                {/* The other two state columns appear HERE, labelled as what
                    they are, and only when they contradict the stage. Showing
                    them unconditionally as "status" is what produced the
                    competing-badge problem in the first place. */}
                {divergences.length > 0 && (
                    <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
                        <h3 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-amber-700 dark:text-amber-300">
                            <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            Record consistency — the columns disagree
                        </h3>
                        <ul className="mt-2 space-y-2">
                            {divergences.map((finding) => (
                                <li key={finding.code} className="text-sm text-amber-900 dark:text-amber-200">
                                    <span className="font-mono text-[10px] font-black uppercase tracking-widest">
                                        {finding.code}
                                    </span>
                                    <span className="ml-2 font-medium">{finding.detail}</span>
                                    <span className="mt-0.5 block text-[11px] font-bold uppercase tracking-wider text-amber-700/80 dark:text-amber-300/80">
                                        Non-authoritative column values — currentStatus: {finding.currentStatus} · isActive:{" "}
                                        {String(finding.isActive)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
                <Section title="Contact" icon={Phone}>
                    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Email" value={employee.email} />
                        <Field label="Mobile" value={employee.phone} />
                        <Field label="Gender" value={employee.gender} />
                        <Field label="Blood group" value={employee.bloodGroup} />
                        <Field label="Marital status" value={employee.maritalStatus} />
                        <div className="sm:col-span-2">
                            <Field label="Current address" value={employee.address} />
                        </div>
                        <div className="sm:col-span-2">
                            <Field label="Permanent address" value={employee.permanentAddress} />
                        </div>
                    </dl>
                    <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
                        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Field label="Emergency contact" value={employee.emergencyContact} />
                            <Field label="Emergency phone" value={employee.emergencyPhone} />
                        </dl>
                    </div>
                </Section>

                <Section title="Employment" icon={Briefcase}>
                    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Designation" value={employee.designation} />
                        <Field label="Department" value={employee.department} />
                        <Field
                            label="Joined"
                            value={
                                <span className="inline-flex items-center gap-1.5">
                                    <Calendar className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                                    {formatDate(employee.joiningDate)}
                                </span>
                            }
                        />
                        <Field
                            label="Employment type"
                            value={employee.employmentType?.replace(/_/g, " ")}
                        />
                        <Field
                            label="Work location"
                            value={
                                <span className="inline-flex items-center gap-1.5">
                                    <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                                    {employee.workLocation}
                                </span>
                            }
                        />
                        <Field label="Probation days" value={employee.probationDays} />
                        <Field
                            label="Reports to"
                            value={
                                employee.manager
                                    ? `${employee.manager.firstName} ${employee.manager.lastName}`
                                    : null
                            }
                        />
                        <Field
                            label="Manager department"
                            value={employee.manager?.department}
                        />
                    </dl>
                </Section>

                <Section title="Document expiry" icon={ShieldCheck}>
                    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {documents.map((doc) => (
                            <div key={doc.label} className="min-w-0">
                                <dt className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                                    {doc.label}
                                </dt>
                                <dd className="mt-0.5 text-sm font-bold text-slate-800 dark:text-slate-100">
                                    {doc.expiry ? formatDate(doc.expiry) : "Not on file"}
                                </dd>
                            </div>
                        ))}
                        <Field label="Visa type" value={employee.visaType} />
                    </dl>
                    {!canViewRestricted && (
                        <p className="mt-4 border-t border-slate-100 pt-3 text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400">
                            Document numbers, government ID, date of birth and nationality are not
                            shown at your access level.
                        </p>
                    )}
                </Section>

                {/* Restricted block. Rendered only for `employees.view`
                    holders — the same capability that exposes these columns on
                    the master list. */}
                {restricted && (
                    <Section title="Restricted records" icon={Wallet}>
                        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Field label="Date of birth" value={formatDate(restricted.dateOfBirth)} />
                            <Field label="Nationality" value={restricted.nationality} />
                            <div className="sm:col-span-2">
                                <Field label="Government ID" value={restricted.governmentId} />
                            </div>
                            <Field label="Bank" value={restricted.bankName} />
                            <Field label="Account number" value={restricted.accountNumber} />
                            <Field label="IBAN" value={restricted.iban} />
                            <Field label="IFSC" value={restricted.ifscCode} />
                            <div className="sm:col-span-2">
                                <dt className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                                    Monthly pay components
                                </dt>
                                <dd className="mt-0.5 text-sm font-bold text-slate-800 dark:text-slate-100">
                                    {[
                                        ["Basic", restricted.basicSalary],
                                        ["Housing", restricted.housingAllowance],
                                        ["Transport", restricted.transportAllowance],
                                        ["Other", restricted.otherAllowance],
                                    ]
                                        .map(
                                            ([label, amount]) =>
                                                `${label}: ${
                                                    typeof amount === "number"
                                                        ? amount.toLocaleString("en-GB", {
                                                              minimumFractionDigits: 2,
                                                          })
                                                        : "—"
                                                }`
                                        )
                                        .join(" · ")}
                                </dd>
                            </div>
                            <Field label="Passport number" value={restricted.passportNumber} />
                            <Field label="Emirates ID" value={restricted.emiratesId} />
                            <Field label="Visa number" value={restricted.visaNumber} />
                        </dl>
                    </Section>
                )}

                <Section title="Record" icon={Building2}>
                    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field label="Roll number" value={employee.rollNumber} />
                        <Field label="Employee code" value={employee.employeeCode} />
                        <Field label="Created" value={formatDate(employee.createdAt)} />
                        <Field label="Last updated" value={formatDate(employee.updatedAt)} />
                    </dl>
                    <p className="mt-4 flex items-start gap-2 border-t border-slate-100 pt-3 text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        {divergences.length === 0 ? (
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                        ) : (
                            <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
                        )}
                        {divergences.length === 0
                            ? "Lifecycle stage, directory status and the payroll flag agree."
                            : "The columns above disagree. The lifecycle stage is the one the workflow and the database constraint reason about."}
                    </p>
                </Section>
            </div>
        </div>
    );
}
