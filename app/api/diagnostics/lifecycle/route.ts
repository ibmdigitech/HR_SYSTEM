/**
 * `GET /api/diagnostics/lifecycle` — read-only employment-state report.
 *
 * The three employment-state columns on `Employee` (`lifecycle`,
 * `currentStatus`, `isActive`) are written independently and nothing enforces
 * agreement between them. That was previously recorded as a blocker on the
 * strength of reading the schema. This route turns it into a number: it counts
 * the rows that contradict themselves, names them, and reports whether the
 * database constrains `User.role` at all.
 *
 * Why `system.audit.view` and not `employees.view`: the report crosses
 * organisational scope. It covers every employee and every user in the
 * organisation, not the caller's department, so it is gated on a capability
 * held only by ADMIN and SUPER_ADMIN
 * (lib/auth/permissions.ts:250, :272). A department-scoped HR account must not
 * be able to enumerate the whole workforce's state.
 *
 * This route is strictly read-only. It runs two `findMany` selects and one
 * `pg_constraint` catalogue query, and returns JSON. It deliberately offers no
 * repair action: choosing the correct value for a diverged row is a business
 * decision, and an endpoint that can both detect and silently correct drift
 * will eventually be used to paper over it.
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authorizePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { collectConsistencyReport } from "@/lib/workflow/lifecycle-consistency";

export const dynamic = "force-dynamic";

export async function GET() {
    const auth = await authorizePermission(PERMISSIONS.SYSTEM_AUDIT_VIEW);
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    try {
        const report = await collectConsistencyReport(prisma);
        return NextResponse.json(report);
    } catch {
        return NextResponse.json(
            { error: "Could not read employment-state diagnostics" },
            { status: 500 }
        );
    }
}
