import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizePermission } from '@/lib/auth/guards';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { logSecurityEvent } from '@/lib/auth/audit';

/**
 * Carries an HTTP status alongside the message, so the catch block can map a
 * business rejection to 404/409 without matching on the wording of an Error.
 * The previous version tested `error.message.includes('not found')`, which
 * would also have swallowed an unrelated driver's message containing those
 * words and returned 400 for a genuine 500.
 */
class LetterApprovalError extends Error {
    constructor(
        readonly kind: 'NOT_FOUND' | 'CONFLICT',
        message: string
    ) {
        super(message);
        this.name = 'LetterApprovalError';
    }
}

export async function POST(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const authResult = await authorizePermission(PERMISSIONS.LETTER_APPROVE);
    if (!authResult.ok) {
        return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const actor = authResult.user;

    try {
        const letter = await prisma.$transaction(async (tx) => {
            // The read below is only for DISTINGUISHING 404 from 409. It is not
            // the guard: a read-then-write inside a transaction still lets two
            // concurrent approvals both observe PENDING and both write. So the
            // write itself carries the precondition, exactly as
            // `lib/workflow/leave.ts` does for leave decisions.
            const current = await tx.letter.findUnique({
                where: { id },
                select: { status: true, referenceNumber: true, templateId: true }
            });

            if (!current) {
                throw new LetterApprovalError('NOT_FOUND', `Letter ${id} does not exist`);
            }

            const updated = await tx.letter.updateMany({
                where: { id, status: 'PENDING' },
                data: {
                    status: 'GENERATED',
                    approvedBy: actor.email,
                    approvedAt: new Date()
                }
            });

            if (updated.count === 0) {
                // Lost the race, or the letter was never PENDING. Either way the
                // precondition failed and nothing was written.
                throw new LetterApprovalError(
                    'CONFLICT',
                    `Cannot approve a letter in status "${current.status}"; only PENDING letters can be approved.`
                );
            }

            return tx.letter.findUniqueOrThrow({
                where: { id },
                select: {
                    id: true,
                    status: true,
                    referenceNumber: true,
                    templateId: true,
                    approvedBy: true,
                    approvedAt: true,
                }
            });
        });

        await logSecurityEvent({
            action: 'LETTER_APPROVED',
            actorEmail: actor.email,
            actorRole: actor.role,
            target: `letter:${letter.id}`,
            outcome: 'SUCCESS',
            requestPath: `/api/letters/${id}/approve`,
            requestMethod: 'POST',
            detail: { referenceNumber: letter.referenceNumber, templateId: letter.templateId },
        });

        return NextResponse.json(letter);
    } catch (error) {
        if (error instanceof LetterApprovalError) {
            return NextResponse.json(
                { error: error.message },
                { status: error.kind === 'NOT_FOUND' ? 404 : 409 }
            );
        }
        console.error(error);
        return NextResponse.json({ error: 'Failed to approve letter' }, { status: 500 });
    }
}
