import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { auth } from '@/auth';
import { authorizePermission } from '@/lib/auth/guards';
import { PERMISSIONS, hasPermission } from '@/lib/auth/permissions';
import { logSecurityEvent, SECURITY_ACTION } from '@/lib/auth/audit';

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
    // Centralized guard. The previous check was `if (!session)`, so ANY
    // authenticated user — including STAFF — could generate a letter for ANY
    // employee by passing an arbitrary employeeId.
    const auth = await authorizePermission(PERMISSIONS.LETTER_GENERATE);
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const actor = auth.user;

    try {
        const body = await req.json();
        const { templateId, employeeId, customFields } = body;

        // A non-privileged caller may only generate their own letter. Previously
        // the client sent `employeeId: undefined` for STAFF, which made
        // `prisma.employee.findUnique({ where: { id: undefined } })` throw and
        // every non-admin attempt failed with "Failed to generate letter".
        let targetEmployeeId: string | null = typeof employeeId === 'string' && employeeId ? employeeId : null;

        if (!targetEmployeeId) {
            if (!actor.employeeId) {
                return NextResponse.json(
                    { error: 'No employee profile is linked to your account. Contact HR.' },
                    { status: 400 }
                );
            }
            targetEmployeeId = actor.employeeId;
        } else if (targetEmployeeId !== actor.employeeId) {
            // IDOR guard: scope-limited roles may not request another employee.
            // `letter.generate` is granted to STAFF, so it cannot be used as the
            // discriminator; the template-management capability is the right test.
            const broad = hasPermission(actor.role, PERMISSIONS.LETTER_TEMPLATE_MANAGE);
            if (!broad) {
                await logSecurityEvent({
                    action: SECURITY_ACTION.ACCESS_DENIED,
                    actorEmail: actor.email,
                    actorRole: actor.role,
                    target: `letter:employee:${targetEmployeeId}`,
                    outcome: 'DENIED',
                    requestPath: '/api/letters',
                    requestMethod: 'POST',
                    detail: { reason: 'cross-employee letter generation' },
                });
                return NextResponse.json({ error: 'You may only generate letters for yourself.' }, { status: 403 });
            }
        }

        // Fetch required data
        const [template, employee] = await Promise.all([
            prisma.letterTemplate.findUnique({ where: { id: templateId } }),
            prisma.employee.findUnique({
                where: { id: targetEmployeeId },
                include: { salaryStructure: true }
            })
        ]);

        if (!template) {
            return NextResponse.json({ error: 'Template not found' }, { status: 404 });
        }
        if (!employee) {
            return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
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
                employeeId: targetEmployeeId,
                templateId,
                referenceNumber: refNumber,
                content_en,
                content_ar,
                // HR and above generate immediately; everyone else goes to
                // review. Derived from the resolved role, not the raw session.
                status: ['ADMIN', 'HR', 'SUPER_ADMIN'].includes(actor.role) ? 'GENERATED' : 'PENDING',
            }
        });

        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: actor.email,
            actorRole: actor.role,
            target: `letter:${letter.id}`,
            outcome: 'SUCCESS',
            requestPath: '/api/letters',
            requestMethod: 'POST',
            detail: { templateId, employeeId: targetEmployeeId, referenceNumber: refNumber },
        });

        return NextResponse.json(letter);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: 'Failed to generate letter' }, { status: 500 });
    }
}
