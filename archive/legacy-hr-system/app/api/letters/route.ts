import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { auth } from '@/auth';

export async function GET(req: Request) {
    const session = await auth();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get('employeeId');

    try {
        const letters = await prisma.letter.findMany({
            where: employeeId ? { employeeId } : {},
            include: {
                employee: {
                    select: { firstName: true, lastName: true, rollNumber: true }
                },
                template: {
                    select: { name: true, type: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        return NextResponse.json(letters);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch letters' }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const session = await auth();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    try {
        const body = await req.json();
        const { templateId, employeeId, customFields } = body;

        // Fetch required data
        const [template, employee] = await Promise.all([
            prisma.letterTemplate.findUnique({ where: { id: templateId } }),
            prisma.employee.findUnique({ 
                where: { id: employeeId },
                include: { salaryStructure: true }
            })
        ]);

        if (!template || !employee) {
            return NextResponse.json({ error: 'Template or Employee not found' }, { status: 404 });
        }

        // Generate Ref Number
        const count = await prisma.letter.count();
        const refNumber = `LTR-UAE-${new Date().getFullYear()}-${String(count + 1).padStart(3, '0')}`;

        // Variable Replacement Logic
        const variables: Record<string, string> = {
            'employee.name': `${employee.firstName} ${employee.lastName}`,
            'employee.emiratesId': employee.governmentId || 'N/A',
            'employee.designation': employee.designation,
            'employee.joiningDate': new Date(employee.joiningDate).toLocaleDateString(),
            'salary.basic': employee.salaryStructure?.basic.toString() || '0',
            'salary.allowances': (
                (employee.salaryStructure?.housingAllowance || 0) + 
                (employee.salaryStructure?.transportAllowance || 0) + 
                (employee.salaryStructure?.medicalAllowance || 0) + 
                (employee.salaryStructure?.otherAllowances || 0)
            ).toString(),
            'salary.total': employee.salaryStructure?.ctc.toString() || '0',
            'company.name': 'Al Barakah Group',
            'company.authorizedSignatory': 'CEO / HR Manager',
            'date.today': new Date().toLocaleDateString(),
            'letter.number': refNumber,
            ...customFields // Allow overriding or adding custom purposes (like NOC purpose)
        };

        const replaceVars = (text: string) => {
            let res = text;
            Object.entries(variables).forEach(([key, val]) => {
                const regex = new RegExp(`{{${key}}}`, 'g');
                res = res.replace(regex, val);
            });
            return res;
        };

        const content_en = replaceVars(template.content_en);
        const content_ar = template.content_ar ? replaceVars(template.content_ar) : null;

        const letter = await prisma.letter.create({
            data: {
                employeeId,
                templateId,
                referenceNumber: refNumber,
                content_en,
                content_ar,
                status: (session.user as any).role === 'ADMIN' ? 'GENERATED' : 'PENDING',
            }
        });

        return NextResponse.json(letter);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Failed to generate letter' }, { status: 500 });
    }
}
