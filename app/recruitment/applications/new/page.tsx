import Link from "next/link";
import prisma from "@/lib/prisma";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { CandidateApplicationForm } from "./CandidateApplicationForm";

export const dynamic = "force-dynamic";

export default async function NewCandidateApplicationPage({
    searchParams,
}: {
    searchParams: Promise<{ jobId?: string }>;
}) {
    await requirePagePermission(PERMISSIONS.RECRUITMENT_CREATE);
    const params = await searchParams;
    const requisitions = await prisma.jobRequisition.findMany({
        where: { status: "APPROVED" },
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true, requisitionCode: true, department: true },
    });

    return (
        <div className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-8">
            <Link href="/recruitment" className="text-xs font-black uppercase tracking-widest text-indigo-600 hover:underline dark:text-indigo-400">
                ← Back to recruitment
            </Link>
            <header className="space-y-2">
                <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">Add candidate to vacancy</h1>
                <p className="text-sm text-slate-500">Record an applicant against an approved vacancy. Consent is required before candidate details are stored.</p>
            </header>
            {requisitions.length > 0 ? (
                <CandidateApplicationForm requisitions={requisitions} initialJobId={params.jobId} />
            ) : (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                    No approved vacancies are accepting applications yet. Approve a requisition, then return here to add a candidate.
                </div>
            )}
        </div>
    );
}
