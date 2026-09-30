import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { auth } from '@/auth';
import { authorizePermission } from '@/lib/auth/guards';
import { PERMISSIONS, hasPermission } from '@/lib/auth/permissions';
import { logSecurityEvent, SECURITY_ACTION } from '@/lib/auth/audit';
import {
    buildLetterVariables,
    renderTemplate,
    unresolvedPlaceholders,
} from '@/lib/letters/variables';
import { scopeEmployeeWhere } from '@/lib/auth/scope';

export async function GET(req: Request) {
    const authResult = await authorizePermission(PERMISSIONS.LETTER_VIEW);
    if (!authResult.ok) {
        return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const actor = authResult.user;

    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get('employeeId');

    try {
        // `scopeEmployeeWhere` narrows an **Employee** clause (`{ id }` for SELF,
        // `{ department }` for DEPARTMENT), so it can only be applied through the
        // `employee` relation — `Letter` itself has neither field. An explicit
        // `employeeId` is ANDed rather than replacing the scope, otherwise any
        // caller could read another employee's letters by guessing their id.
        const employeeScope = { employee: scopeEmployeeWhere(authResult.subject) };
        const whereClause = employeeId
            ? { AND: [{ employeeId }, employeeScope] }
            : employeeScope;

        const letters = await prisma.letter.findMany({
            where: whereClause,
            include: {
                employee: {
                    select: { firstName: true, lastName: true, rollNumber: true }
                },
                candidate: {
                    select: { firstName: true, lastName: true, candidateCode: true }
                },
                template: {
                    select: { name: true, type: true }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: 100
        });
        return NextResponse.json(letters);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch letters' }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const authResult = await authorizePermission(PERMISSIONS.LETTER_GENERATE);
    if (!authResult.ok) {
        return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const actor = authResult.user;

    try {
        const body = await req.json();
        const { templateId, employeeId, candidateId, customFields } = body;

        // Validate that exactly one of employeeId or candidateId is provided
        if (!employeeId && !candidateId) {
            return NextResponse.json(
                { error: 'Either employeeId or candidateId is required' },
                { status: 400 }
            );
        }
        if (employeeId && candidateId) {
            return NextResponse.json(
                { error: 'Provide either employeeId or candidateId, not both' },
                { status: 400 }
            );
        }

        let targetEmployeeId: string | null = employeeId || null;
        let targetCandidateId: string | null = candidateId || null;

        // Cross-employee authorization check
        if (targetEmployeeId && targetEmployeeId !== actor.employeeId) {
            const hasBroadAccess = hasPermission(actor.role, PERMISSIONS.LETTER_TEMPLATE_MANAGE);
            if (!hasBroadAccess) {
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
        const [template, employee, candidate] = await Promise.all([
            prisma.letterTemplate.findUnique({ where: { id: templateId } }),
            targetEmployeeId ? prisma.employee.findUnique({
                where: { id: targetEmployeeId },
                include: { salaryStructure: true }
            }) : Promise.resolve(null),
            targetCandidateId ? prisma.candidate.findUnique({
                where: { id: targetCandidateId }
            }) : Promise.resolve(null)
        ]);

        if (!template) {
            return NextResponse.json({ error: 'Template not found' }, { status: 404 });
        }
        if (!template.isActive) {
            return NextResponse.json({ error: 'Template is inactive' }, { status: 400 });
        }
        if (targetEmployeeId && !employee) {
            return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
        }
        if (targetCandidateId && !candidate) {
            return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
        }

        // Validate required fields for the template
        const validationError = validateRequiredFields(template, employee, candidate);
        if (validationError) {
            return NextResponse.json({ error: validationError }, { status: 400 });
        }

        // Generate reference number with transaction and retry logic
        const letter = await prisma.$transaction(async (tx) => {
            let refNumber: string;
            let attempt = 0;
            const maxAttempts = 3;

            while (attempt < maxAttempts) {
                const count = await tx.letter.count();
                refNumber = `LTR-UAE-${new Date().getFullYear()}-${String(count + 1).padStart(3, '0')}`;

                try {
                    // A letter is issued against EITHER an employee or a
                    // candidate, and only one of the two is loaded. The two
                    // branches are resolved here rather than in a ternary so the
                    // compiler can see that each side is non-null: written as
                    // `targetEmployeeId ? employee! : candidate!` the expression
                    // has the union of both row types, and the candidate side
                    // (which has no `rollNumber`) made the whole call
                    // un-type-checkable. Only the shape is asserted here — the
                    // 404s above already proved the row exists.
                    const subject = targetEmployeeId
                        ? (employee as NonNullable<typeof employee>)
                        : (candidate as NonNullable<typeof candidate>);

                    const variables = buildLetterVariables(
                        subject,
                        {
                            referenceNumber: refNumber,
                            customFields: sanitizeCustomFields(customFields, template.type),
                        }
                    );

                    const content_en = renderTemplate(template.content_en, variables);
                    const content_ar = template.content_ar ? renderTemplate(template.content_ar, variables) : null;

                    const unresolved = [
                        ...unresolvedPlaceholders(template.content_en, variables),
                        ...(template.content_ar ? unresolvedPlaceholders(template.content_ar, variables) : []),
                    ];
                    if (unresolved.length > 0) {
                        console.warn(
                            `[letters] template "${template.name}" (${template.id}) has unresolved placeholders: ${unresolved.join(", ")}`
                        );
                    }

                    // Check for missing required values
                    const missingRequired = checkMissingRequiredValues(template, variables);
                    if (missingRequired.length > 0) {
                        // This must THROW, not return a NextResponse. A callback
                        // that returns normally commits the transaction, so
                        // returning here would create no row yet let the code
                        // below treat the result as a Letter — the caller got a
                        // 400 while the reference number had already been
                        // consumed, and `letter.id` was undefined in the audit
                        // entry. Throwing rolls back and unwinds to the handler
                        // below, which turns it back into that 400.
                        throw new MissingRequiredValues(missingRequired);
                    }

                    const created = await tx.letter.create({
                        data: {
                            employeeId: targetEmployeeId,
                            candidateId: targetCandidateId,
                            templateId,
                            referenceNumber: refNumber,
                            content_en,
                            content_ar,
                            status: ['ADMIN', 'HR', 'SUPER_ADMIN'].includes(actor.role) ? 'GENERATED' : 'PENDING',
                        }
                    });

                    return created;
                } catch (error: any) {
                    if (error.code === 'P2002' && error.meta?.target?.includes('referenceNumber')) {
                        attempt++;
                        continue;
                    }
                    throw error;
                }
            }
            throw new Error('Failed to generate unique reference number after retries');
        });

        await logSecurityEvent({
            action: 'LETTER_GENERATED',
            actorEmail: actor.email,
            actorRole: actor.role,
            target: `letter:${letter.id}`,
            outcome: 'SUCCESS',
            requestPath: '/api/letters',
            requestMethod: 'POST',
            detail: { templateId, employeeId: targetEmployeeId, candidateId: targetCandidateId, referenceNumber: letter.referenceNumber },
        });

        return NextResponse.json(letter);
    } catch (error) {
        // Unwinds the throw from inside the transaction, which rolls it back.
        if (error instanceof MissingRequiredValues) {
            return NextResponse.json(
                {
                    error: `Required values missing: ${error.fields.join(', ')}`,
                    missingFields: error.fields,
                },
                { status: 400 }
            );
        }
        console.error(error);
        return NextResponse.json({ error: 'Failed to generate letter' }, { status: 500 });
    }
}

/**
 * Signals that a template needs values the subject record does not have.
 *
 * A dedicated class rather than a string check, so the transaction's rollback
 * path cannot be confused with an unrelated failure carrying a similar
 * message.
 */
class MissingRequiredValues extends Error {
    readonly fields: string[];
    constructor(fields: string[]) {
        super(`Required values missing: ${fields.join(', ')}`);
        this.name = 'MissingRequiredValues';
        this.fields = fields;
    }
}

function validateRequiredFields(
    template: { type: string; content_en: string; content_ar?: string | null },
    employee: any,
    candidate: any
): string | null {
    const requiredByType: Record<string, string[]> = {
        EMPLOYMENT: ['employee.name', 'employee.rollNumber', 'employee.designation', 'employee.department', 'employee.joiningDate'],
        PAYROLL: ['employee.name', 'employee.rollNumber', 'salary.basic', 'salary.total'],
        NOC: ['employee.name', 'employee.rollNumber', 'employee.passportNumber'],
        OFFER: ['candidate.firstName', 'candidate.lastName', 'candidate.candidateCode'],
        APPOINTMENT: ['employee.name', 'employee.rollNumber', 'employee.designation', 'employee.department', 'employee.joiningDate'],
        RELIEVING: ['employee.name', 'employee.rollNumber', 'employee.joiningDate'],
        SALARY_CERTIFICATE: ['employee.name', 'employee.rollNumber', 'salary.basic', 'salary.allowances', 'salary.total'],
    };

    const required = requiredByType[template.type] || [];
    const missing: string[] = [];

    for (const field of required) {
        if (field.startsWith('employee.')) {
            const key = field.split('.')[1];
            const val = employee?.[key];
            if (!val && val !== 0) missing.push(field);
        } else if (field.startsWith('salary.')) {
            const key = field.split('.')[1];
            const val = employee?.salaryStructure?.[key];
            if (!val && val !== 0) missing.push(field);
        } else if (field.startsWith('candidate.')) {
            const key = field.split('.')[1];
            const val = candidate?.[key];
            if (!val) missing.push(field);
        }
    }

    if (missing.length > 0) {
        return `Missing required fields for ${template.type} template: ${missing.join(', ')}`;
    }
    return null;
}

function sanitizeCustomFields(customFields: Record<string, string> | null | undefined, templateType: string): Record<string, string> | null {
    if (!customFields) return null;

    const allowedFields: Record<string, string[]> = {
        EMPLOYMENT: ['request.purpose'],
        PAYROLL: ['request.purpose'],
        NOC: ['request.purpose', 'request.destination', 'request.travelDates'],
        OFFER: ['request.specialConditions'],
        APPOINTMENT: ['request.purpose'],
        RELIEVING: ['request.reason', 'request.lastWorkingDay'],
        SALARY_CERTIFICATE: ['request.purpose'],
    };

    const allowed = allowedFields[templateType] || ['request.purpose'];
    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(customFields)) {
        if (allowed.includes(key) && value !== null && value !== undefined) {
            sanitized[key] = String(value);
        }
    }

    return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function checkMissingRequiredValues(template: { content_en: string; content_ar?: string | null }, variables: Record<string, string>): string[] {
    const requiredKeys = new Set<string>();

    // Extract all placeholders from both content_en and content_ar
    const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
    for (const content of [template.content_en, template.content_ar].filter(Boolean)) {
        for (const match of content!.matchAll(PLACEHOLDER)) {
            const key = match[1];
            if (!key.startsWith('request.') && !key.startsWith('company.') && !key.startsWith('date.') && !key.startsWith('letter.')) {
                requiredKeys.add(key);
            }
        }
    }

    const missing: string[] = [];
    for (const key of requiredKeys) {
        const value = variables[key];
        if (value === '—' || value === '' || value === undefined) {
            missing.push(key);
        }
    }

    return missing;
}
