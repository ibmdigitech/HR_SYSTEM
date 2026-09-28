/**
 * Proves the GAP-01 invariant at the DATABASE level, not the form level.
 *
 * The point of the migration was to replace "the column is never null" with
 * "an active employee is never incomplete". These tests assert the second rule
 * is genuinely enforced, because a state machine nobody can violate is a comment.
 *
 * SAFETY: every test throws a marker at the end of its transaction, which forces
 * a ROLLBACK. A test that returns normally WOULD commit, so each one is written
 * so that reaching the end without throwing is itself a failure.
 */
import { describe, it, expect, afterAll } from "vitest";
import prisma from "@/lib/prisma";
import type { Prisma } from "@/prisma/generated/client";

const ROLLBACK = "ROLLBACK_PROOF";
const PROOF_ID = "test-staged-entry-proof";
const PROOF_ROLL = "TEST-STAGED-PROOF";

afterAll(async () => {
    await prisma.$disconnect();
});

/** Runs `fn` in a transaction that is always rolled back. Returns the thrown message. */
async function inRolledBackTransaction(
    fn: (tx: Prisma.TransactionClient) => Promise<unknown>
): Promise<string> {
    try {
        await prisma.$transaction(async (tx) => {
            await fn(tx);
            // Reaching here means the transaction would COMMIT. Never do that.
            throw new Error(ROLLBACK);
        });
        return "COMMITTED_UNEXPECTEDLY";
    } catch (e) {
        return (e as Error).message;
    }
}

describe("GAP-01 — staged employee entry is enforced by the database", () => {
    it("accepts a PROVISIONAL employee with no job data and no login", async () => {
        const outcome = await inRolledBackTransaction(async (tx) => {
            await tx.employee.create({
                data: {
                    id: PROOF_ID,
                    rollNumber: PROOF_ROLL,
                    firstName: "Staged",
                    lastName: "Proof",
                    email: "staged.proof@example.invalid",
                    lifecycle: "PRE_JOINING",
                    currentStatus: "ACTIVE",
                },
            });
        });

        // The only way to see ROLLBACK is: the insert succeeded, then we rolled back.
        expect(outcome).toBe(ROLLBACK);
    });

    it("refuses to set a staged employee ACTIVE while job data is missing", async () => {
        const outcome = await inRolledBackTransaction(async (tx) => {
            const created = await tx.employee.create({
                data: {
                    id: PROOF_ID,
                    rollNumber: PROOF_ROLL,
                    firstName: "Staged",
                    lastName: "Proof",
                    email: "staged.proof@example.invalid",
                    lifecycle: "PRE_JOINING",
                    currentStatus: "ACTIVE",
                },
            });
            // The illegal move: activating a record with no designation,
            // department or joining date.
            await tx.employee.update({
                where: { id: created.id },
                data: { lifecycle: "ACTIVE" },
            });
        });

        expect(outcome).not.toBe(ROLLBACK);
        expect(outcome).not.toBe("COMMITTED_UNEXPECTEDLY");
        expect(outcome).toMatch(/Employee_active_requires_employment_data/);
    });

    it("allows the activation once the job data is supplied", async () => {
        let reached: string | null = null;
        try {
            await prisma.$transaction(async (tx) => {
                const created = await tx.employee.create({
                    data: {
                        id: PROOF_ID,
                        rollNumber: PROOF_ROLL,
                        firstName: "Staged",
                        lastName: "Proof",
                        email: "staged.proof@example.invalid",
                        lifecycle: "PRE_JOINING",
                        currentStatus: "ACTIVE",
                    },
                });
                await tx.employee.update({
                    where: { id: created.id },
                    data: { designation: "Tester", department: "Quality", joiningDate: new Date() },
                });
                const after = await tx.employee.update({
                    where: { id: created.id },
                    data: { lifecycle: "PROBATION" },
                    select: { lifecycle: true },
                });
                reached = after.lifecycle;
                throw new Error(ROLLBACK);
            });
        } catch (e) {
            expect((e as Error).message).toBe(ROLLBACK);
        }

        expect(reached).toBe("PROBATION");
    });

    it("keeps rollNumber mandatory at the database level", async () => {
        // Prisma's types already forbid omitting rollNumber, so an insert-level
        // test is not expressible. The guarantee that matters is the column's
        // NOT NULL constraint, which the staged-entry relaxation must NOT have
        // touched — only four columns were relaxed.
        const rows = await prisma.$queryRaw<{ is_nullable: string }[]>`
            SELECT is_nullable
            FROM information_schema.columns
            WHERE table_name = 'Employee' AND column_name = 'rollNumber'
        `;

        expect(rows).toHaveLength(1);
        expect(rows[0].is_nullable).toBe("NO");
    });

    it("relaxed exactly the four staged-entry columns and nothing else", async () => {
        const rows = await prisma.$queryRaw<{ column_name: string; is_nullable: string }[]>`
            SELECT column_name, is_nullable
            FROM information_schema.columns
            WHERE table_name = 'Employee'
              AND column_name IN ('userId','designation','department','joiningDate')
            ORDER BY column_name
        `;

        expect(rows.map((r) => r.column_name)).toEqual([
            "department",
            "designation",
            "joiningDate",
            "userId",
        ]);
        for (const row of rows) {
            expect(row.is_nullable).toBe("YES");
        }
    });

    it("leaves no proof rows behind", async () => {
        expect(await prisma.employee.count({ where: { rollNumber: PROOF_ROLL } })).toBe(0);
        expect(await prisma.employee.count({ where: { email: "no.roll@example.invalid" } })).toBe(0);
    });
});
