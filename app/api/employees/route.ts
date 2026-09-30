import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { auth } from '@/auth';
import { NOT_ARCHIVED } from '@/lib/employees/retention';

export async function GET() {
    const session = await auth();
    if (!session || !["ADMIN", "HR"].includes((session.user as { role: string }).role)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const employees = await prisma.employee.findMany({
            // RET-001: this is the employee DIRECTORY, so it must not serve
            // archived records. Before the archive landed this query carried no
            // filter at all, which meant it served every row in the table
            // regardless of employment state — an archived employee would have
            // kept appearing here, name and roll number and government ID,
            // with nothing on the page to say so.
            //
            // `deletedAt: null` is the tombstone filter. `isActive` is not added:
            // this endpoint has always returned inactive employees too (HR uses
            // it to inspect someone who has left), and narrowing it would be a
            // behaviour change nobody asked for. The archive sets `isActive`
            // separately, and that column is left as this endpoint found it.
            where: NOT_ARCHIVED,
            select: {
                id: true,
                firstName: true,
                lastName: true,
                designation: true,
                rollNumber: true,
                governmentId: true,
                joiningDate: true,
            },
            orderBy: { firstName: 'asc' }
        });
        return NextResponse.json(employees);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch employees' }, { status: 500 });
    }
}
