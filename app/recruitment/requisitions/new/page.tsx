import Link from "next/link";
import prisma from "@/lib/prisma";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { NewRequisitionForm } from "./NewRequisitionForm";

/**
 * /recruitment/requisitions/new — raise a job requisition.
 *
 * This is the route the "New Job Requisition" button on /recruitment opens.
 * A page route rather than a dialog because the form has enough fields that a
 * modal is unusable on a phone, and a real URL is linkable from an approval
 * email.
 *
 * The page guard uses the same capability the server action does
 * (`recruitment.create`) — the action guards again regardless, because a page
 * guard is a rendering decision and the action is the security boundary.
 */
export const dynamic = "force-dynamic";

export default async function NewJobRequisitionPage() {
    await requirePagePermission(PERMISSIONS.RECRUITMENT_CREATE);

    // Only needed when the vacancy is a REPLACEMENT, but the form lets the
    // user switch to a replacement at any point, so the options are loaded with
    // the page rather than fetched afterwards.
    const employees = await prisma.employee.findMany({
        where: { currentStatus: { in: ["ACTIVE", "ON_LEAVE"] } },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        take: 200,
        select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            department: true,
        },
    });

    return (
        <div className="w-full min-w-0 max-w-4xl mx-auto space-y-6 p-4 md:p-8">
            <div className="space-y-2">
                <Link
                    href="/recruitment"
                    className="text-xs font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                    ← Back to recruitment
                </Link>
                <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">
                    New job requisition
                </h1>
                <p className="text-slate-500 font-medium">
                    Saved as a draft. A requisition must be submitted and cleared by the manager, HR
                    and finance before it can accept candidates — nothing is published by creating it.
                </p>
            </div>

            <NewRequisitionForm employees={employees} />
        </div>
    );
}
