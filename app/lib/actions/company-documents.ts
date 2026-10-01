"use server";

import prisma from "@/lib/prisma";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { requireAnyPermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";

export type CompanyDocumentsResult =
    | { success: true; data: Awaited<ReturnType<typeof prisma.companyDocument.findMany>> }
    | { success: false; error: string; data?: undefined };

export type CompanyDocumentResult =
    | { success: true; data: Awaited<ReturnType<typeof prisma.companyDocument.findUnique>> }
    | { success: false; error: string; data?: undefined };

export async function getCompanyDocuments(): Promise<CompanyDocumentsResult> {
    await requireAnyPermission([PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_MANAGE]);

    try {
        const documents = await prisma.companyDocument.findMany({
            orderBy: { createdAt: "desc" }
        });
        return { success: true, data: documents };
    } catch (error) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}

export async function getCompanyDocumentById(id: string): Promise<CompanyDocumentResult> {
    await requireAnyPermission([PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_MANAGE]);

    try {
        const document = await prisma.companyDocument.findUnique({
            where: { id }
        });
        if (!document) return { success: false, error: "Document not found" };
        return { success: true, data: document };
    } catch (error) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}

export async function createCompanyDocument(formData: FormData) {
    await requireAnyPermission([PERMISSIONS.SETTINGS_MANAGE]);

    const session = await auth();
    if (!session?.user?.email) return { success: false, error: "Unauthorized" };

    const title = formData.get("title") as string;
    const type = formData.get("type") as string;
    const category = formData.get("category") as string;
    const description = formData.get("description") as string;
    const fileUrl = formData.get("fileUrl") as string;
    const fileName = formData.get("fileName") as string;
    const fileType = formData.get("fileType") as string;
    const version = formData.get("version") as string;
    const effectiveFrom = formData.get("effectiveFrom") as string;
    const effectiveTo = formData.get("effectiveTo") as string;

    if (!title || !type || !category || !fileUrl || !fileName) {
        return { success: false, error: "Missing required fields" };
    }

    try {
        const document = await prisma.companyDocument.create({
            data: {
                title,
                type,
                category,
                description,
                fileUrl,
                fileName,
                fileType,
                version: version || "1.0",
                effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : null,
                effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
                publishedBy: session.user.email,
            }
        });

        revalidatePath("/company/documents");
        return { success: true, data: document };
    } catch (error) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}

export async function updateCompanyDocument(id: string, formData: FormData) {
    await requireAnyPermission([PERMISSIONS.SETTINGS_MANAGE]);

    const title = formData.get("title") as string;
    const type = formData.get("type") as string;
    const category = formData.get("category") as string;
    const description = formData.get("description") as string;
    const fileUrl = formData.get("fileUrl") as string;
    const fileName = formData.get("fileName") as string;
    const fileType = formData.get("fileType") as string;
    const version = formData.get("version") as string;
    const isActive = formData.get("isActive") === "true";
    const effectiveFrom = formData.get("effectiveFrom") as string;
    const effectiveTo = formData.get("effectiveTo") as string;

    try {
        const data: any = {};
        if (title) data.title = title;
        if (type) data.type = type;
        if (category) data.category = category;
        if (description !== null) data.description = description;
        if (fileUrl) data.fileUrl = fileUrl;
        if (fileName) data.fileName = fileName;
        if (fileType) data.fileType = fileType;
        if (version) data.version = version;
        data.isActive = isActive;
        if (effectiveFrom) data.effectiveFrom = new Date(effectiveFrom);
        if (effectiveTo) data.effectiveTo = new Date(effectiveTo);

        const document = await prisma.companyDocument.update({
            where: { id },
            data
        });

        revalidatePath("/company/documents");
        return { success: true, data: document };
    } catch (error) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}

export async function deleteCompanyDocument(id: string) {
    await requireAnyPermission([PERMISSIONS.SETTINGS_MANAGE]);

    try {
        await prisma.companyDocument.delete({
            where: { id }
        });

        revalidatePath("/company/documents");
        return { success: true };
    } catch (error) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}
