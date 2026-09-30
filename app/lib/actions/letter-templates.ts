"use server";

import prisma from "@/lib/prisma";
import { requireAnyPermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
export interface LetterTemplateData {
    name: string;
    type: string;
    content_en: string;
    content_ar?: string;
    isActive?: boolean;
}

export async function getLetterTemplates() {
    await requireAnyPermission([PERMISSIONS.LETTER_TEMPLATE_MANAGE]);

    try {
        const templates = await prisma.letterTemplate.findMany({
            orderBy: { name: 'asc' },
        });
        return { success: true, data: templates };
    } catch (error: unknown) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}

export async function getLetterTemplateById(id: string) {
    await requireAnyPermission([PERMISSIONS.LETTER_TEMPLATE_MANAGE]);

    try {
        const template = await prisma.letterTemplate.findUnique({
            where: { id },
        });
        if (!template) throw new Error("Template not found");
        return { success: true, data: template };
    } catch (error: unknown) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}

export async function createLetterTemplate(data: LetterTemplateData) {
    await requireAnyPermission([PERMISSIONS.LETTER_TEMPLATE_MANAGE]);

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
    } catch (error: unknown) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}

export async function updateLetterTemplate(id: string, data: Partial<LetterTemplateData>) {
    await requireAnyPermission([PERMISSIONS.LETTER_TEMPLATE_MANAGE]);

    try {
        const template = await prisma.letterTemplate.update({
            where: { id },
            data: {
                ...data,
            },
        });
        return { success: true, data: template };
    } catch (error: unknown) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}

export async function deleteLetterTemplate(id: string) {
    await requireAnyPermission([PERMISSIONS.LETTER_TEMPLATE_MANAGE]);

    try {
        await prisma.letterTemplate.delete({
            where: { id },
        });
        return { success: true };
    } catch (error: unknown) {
        return { success: false, error: (error instanceof Error ? error.message : "Unknown error") };
    }
}