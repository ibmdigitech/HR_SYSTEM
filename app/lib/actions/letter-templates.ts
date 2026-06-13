"use server";

import prisma from "@/lib/prisma";
import { auth } from "@/auth";

export interface LetterTemplateData {
    name: string;
    type: string;
    content_en: string;
    content_ar?: string;
    isActive?: boolean;
}

export async function getLetterTemplates() {
    try {
        const templates = await prisma.letterTemplate.findMany({
            orderBy: { name: 'asc' },
        });
        return { success: true, data: templates };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function getLetterTemplateById(id: string) {
    try {
        const template = await prisma.letterTemplate.findUnique({
            where: { id },
        });
        if (!template) throw new Error("Template not found");
        return { success: true, data: template };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function createLetterTemplate(data: LetterTemplateData) {
    const session = await auth();
    if (!session || ((session.user as any)?.role !== "ADMIN" && (session.user as any)?.role !== "HR")) {
        throw new Error("Unauthorized");
    }

    try {
        const template = await prisma.letterTemplate.create({
            data: {
                name: data.name,
                type: data.type,
                content_en: data.content_en,
                content_ar: data.content_ar,
                isActive: data.isActive !== undefined ? data.isActive : true,
            },
        });
        return { success: true, data: template };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function updateLetterTemplate(id: string, data: Partial<LetterTemplateData>) {
    const session = await auth();
    if (!session || ((session.user as any)?.role !== "ADMIN" && (session.user as any)?.role !== "HR")) {
        throw new Error("Unauthorized");
    }

    try {
        const template = await prisma.letterTemplate.update({
            where: { id },
            data: {
                ...data,
            },
        });
        return { success: true, data: template };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function deleteLetterTemplate(id: string) {
    const session = await auth();
    if (!session || ((session.user as any)?.role !== "ADMIN" && (session.user as any)?.role !== "HR")) {
        throw new Error("Unauthorized");
    }

    try {
        await prisma.letterTemplate.delete({
            where: { id },
        });
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}
