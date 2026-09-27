import "server-only";
import prisma from "@/lib/prisma";
import { requirePermission, getSessionUser } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

/** Offer read models (P1 §14, §23). */

export const OFFER_PAGE_SIZE = 20;

export async function requireOfferAccess() {
    const session = await getSessionUser();
    if (!session.ok) redirect("/login");
    await requirePermission(PERMISSIONS.RECRUITMENT_OFFER);
    return session.user;
}

export interface OfferListItem {
    id: string;
    version: number;
    status: string;
    designation: string;
    department: string;
    offeredSalary: number;
    allowances: number;
    joiningDate: Date;
    offerExpiry: Date | null;
    createdAt: Date;
    /** A superseded version is history and cannot be actioned. */
    superseded: boolean;
    supersededById: string | null;
    letterRecordId: string | null;
    hasAcceptedOffer: boolean;
    candidate: { id: string; firstName: string; lastName: string; email: string };
    jobTitle: string | null;
    requisitionCode: string | null;
}

export async function listOffers(params?: { status?: string; page?: number }): Promise<{
    items: OfferListItem[];
    total: number;
    page: number;
    pageSize: number;
}> {
    await requireOfferAccess();

    const page = Math.max(1, params?.page ?? 1);
    const where = params?.status ? { status: params.status } : {};

    const [total, rows] = await Promise.all([
        prisma.offerLetter.count({ where }),
        prisma.offerLetter.findMany({
            where,
            // Latest version first for the same candidate.
            orderBy: [{ candidateId: "asc" }, { version: "desc" }],
            skip: (page - 1) * OFFER_PAGE_SIZE,
            take: OFFER_PAGE_SIZE,
            select: {
                id: true,
                version: true,
                status: true,
                designation: true,
                department: true,
                offeredSalary: true,
                allowances: true,
                joiningDate: true,
                offerExpiry: true,
                createdAt: true,
                supersededById: true,
                letterRecordId: true,
                candidate: { select: { id: true, firstName: true, lastName: true, email: true } },
                application: {
                    select: {
                        jobRequisition: { select: { title: true, requisitionCode: true } },
                    },
                },
            },
        }),
    ]);

    return {
        total,
        page,
        pageSize: OFFER_PAGE_SIZE,
        items: rows.map((r) => ({
            id: r.id,
            version: r.version,
            status: r.status,
            designation: r.designation,
            department: r.department,
            offeredSalary: r.offeredSalary,
            allowances: r.allowances,
            joiningDate: r.joiningDate,
            offerExpiry: r.offerExpiry,
            createdAt: r.createdAt,
            superseded: Boolean(r.supersededById),
            supersededById: r.supersededById,
            letterRecordId: r.letterRecordId,
            hasAcceptedOffer: r.status === OFFER_ACCEPTED,
            candidate: r.candidate,
            jobTitle: r.application?.jobRequisition.title ?? null,
            requisitionCode: r.application?.jobRequisition.requisitionCode ?? null,
        })),
    };
}

const OFFER_ACCEPTED = "ACCEPTED";

/** Applications that can receive an offer — the state machine allows it from SELECTED. */
export async function getOfferableApplications() {
    await requireOfferAccess();
    return prisma.application.findMany({
        where: { status: { in: ["SELECTED", "OFFERED"] } },
        orderBy: { appliedAt: "desc" },
        select: {
            id: true,
            candidateId: true,
            candidate: { select: { firstName: true, lastName: true } },
            jobRequisition: { select: { title: true, department: true } },
        },
    });
}

export async function getOfferDetail(id: string) {
    await requireOfferAccess();
    return prisma.offerLetter.findUnique({
        where: { id },
        include: {
            candidate: true,
            application: {
                select: {
                    id: true,
                    status: true,
                    jobRequisition: { select: { title: true, requisitionCode: true, department: true } },
                },
            },
            letterRecord: {
                select: { id: true, referenceNumber: true, content_en: true, content_ar: true },
            },
        },
    });
}
