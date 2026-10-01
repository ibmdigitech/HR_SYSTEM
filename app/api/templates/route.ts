import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizePermission, authorizeAnyPermission } from '@/lib/auth/guards';
import { PERMISSIONS } from '@/lib/auth/permissions';

export async function GET() {
    const authResult = await authorizeAnyPermission([PERMISSIONS.LETTER_VIEW, PERMISSIONS.LETTER_TEMPLATE_MANAGE]);
    if (!authResult.ok) {
        return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    try {
        const templates = await prisma.letterTemplate.findMany({
            where: { isActive: true },
            orderBy: { name: 'asc' }
        });
        return NextResponse.json(templates);
    } catch (error: unknown) {
        console.error("[API_TEMPLATES_GET_ERROR]", error);
        return NextResponse.json({ error: (error instanceof Error ? error.message : "Unknown error") || 'Failed to fetch templates' }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const authResult = await authorizePermission(PERMISSIONS.LETTER_TEMPLATE_MANAGE);
    if (!authResult.ok) {
        return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    try {
        const data = await req.json();
        const template = await prisma.letterTemplate.create({
            data: {
                name: data.name,
                type: data.type,
                content_en: data.content_en,
                content_ar: data.content_ar,
                isActive: true
            }
        });
        return NextResponse.json(template);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to create template' }, { status: 500 });
    }
}
