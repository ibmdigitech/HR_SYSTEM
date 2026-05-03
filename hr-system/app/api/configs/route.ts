import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { auth } from '@/auth';

export async function GET(request: Request) {
    const session = await auth();
    if (!session || (session.user as any).role !== 'ADMIN' && (session.user as any).role !== 'MANAGER') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const module = searchParams.get('module');

    try {
        const configs = await prisma.serviceConfig.findMany({
            where: module ? { module, isActive: true } : { isActive: true },
            orderBy: { key: 'asc' },
        });
        return NextResponse.json(configs);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch configurations' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const session = await auth();
    if (!session || (session.user as any).role !== 'ADMIN') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { id, module, key, value, label, description, type, options } = body;

        const config = await prisma.serviceConfig.upsert({
            where: id ? { id } : { module_key: { module, key } },
            update: {
                value: String(value),
                label,
                description,
                type,
                options,
                updatedAt: new Date(),
            },
            create: {
                module,
                key,
                label,
                description,
                type,
                value: String(value),
                options,
            },
        });

        return NextResponse.json(config);
    } catch (error) {
        console.error('Config update error:', error);
        return NextResponse.json({ error: 'Failed to update configuration' }, { status: 500 });
    }
}
