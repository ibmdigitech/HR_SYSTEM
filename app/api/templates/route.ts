import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { auth } from '@/auth';

export async function GET() {
    const session = await auth();
    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    const session = await auth();
    if (!session || (session.user as { role: string }).role !== 'ADMIN') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
