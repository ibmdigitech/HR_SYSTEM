import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { auth } from '@/auth';

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const session = await auth();
    if (!session || !["ADMIN", "HR"].includes((session.user as { role: string }).role)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const letter = await prisma.letter.update({
            where: { id },
            data: {
                status: 'GENERATED',
                approvedBy: session.user?.email || 'System',
                approvedAt: new Date()
            }
        });
        return NextResponse.json(letter);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to approve letter' }, { status: 500 });
    }
}
