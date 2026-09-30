/**
 * GET /api/employees/[id] — one employee profile, for the detail page.
 *
 * SECURITY MODEL
 *  1. Authentication. No session -> 401, via the central guard.
 *  2. Capability. The caller must hold a reason to read employee records at
 *     all. `employees.view` is the HR/ADMIN directory capability; `leave.view`
 *     is what makes a MANAGER (who approves their team's leave) and a STAFF
 *     member (who reads their own record) legitimate readers of ONE profile.
 *     A role holding neither — FINANCE, whose legitimate route to employee data
 *     is payroll — is refused with 403. These are the guard helpers, not
 *     ad-hoc role strings.
 *  3. Scope. The organisational boundary is pushed INTO the query by
 *     `scopeEmployeeWhere`, so a MANAGER reads only their own department and a
 *     STAFF member only themselves. The predicate is not applied after the
 *     fetch: an id the caller may not see must never reach the database as an
 *     unrestricted lookup, and must never come back "then get filtered out".
 *
 * 404, NOT 403, FOR AN OUT-OF-SCOPE ID — DELIBERATE
 * A 403 on a specific id tells the caller "this record exists and you may not
 * have it", which is itself a cross-department disclosure: it turns the
 * endpoint into an oracle that confirms who works for the company. Returning
 * the same 404 for "does not exist" and "exists but is outside your scope"
 * makes the two indistinguishable. 403 is therefore reserved for the case that
 * says nothing about any particular record: the caller holds no capability to
 * read employee records at all.
 *
 * FIELDS
 * Explicit `select`, never the whole row — see `employee-select.ts` for why.
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authorizeAnyPermission } from "@/lib/auth/guards";
import { PERMISSIONS, resolvePermissions } from "@/lib/auth/permissions";
import { scopeEmployeeWhere } from "@/lib/auth/scope";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";
import { PROFILE_SELECT, FULL_SELECT } from "@/app/employees/[id]/employee-select";

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await authorizeAnyPermission([
        PERMISSIONS.EMPLOYEES_VIEW,
        PERMISSIONS.LEAVE_VIEW,
    ]);
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user, subject } = auth;
    const { id } = await params;

    // The IDOR boundary, expressed as a predicate the database enforces.
    //
    // The two clauses are ANDed, and the order matters. Passing `{ id }` INTO
    // `scopeEmployeeWhere` does not narrow to "this employee, if in scope" — for
    // SELF scope that helper returns `{ id: subject.employeeId }`, which
    // OVERWRITES the requested id. The query would then match the caller's own
    // row whatever was asked for, and answer 200 with the wrong person. With
    // `AND`, an id outside the caller's scope simply matches no row and becomes
    // the 404 below.
    //
    //   ALL        -> { AND: [{ id }, {}] }                      -> the requested row
    //   SELF       -> { AND: [{ id }, { id: subject.employeeId }] } -> only if it IS theirs
    //   DEPARTMENT -> { AND: [{ id }, { department }] }          -> only if in dept
    //
    // The scope is still enforced inside the query, never as a post-fetch filter.
    const where = { AND: [{ id }, scopeEmployeeWhere(subject)] };

    // `employees.view` is exactly the capability that already exposes the pay,
    // bank, identity and document-number columns on the master list, so only
    // those callers receive them here.
    const { permissions } = resolvePermissions(user.role);
    const canViewRestricted = permissions.has(PERMISSIONS.EMPLOYEES_VIEW);

    try {
        const employee = canViewRestricted
            ? await prisma.employee.findFirst({ where, select: FULL_SELECT })
            : await prisma.employee.findFirst({ where, select: PROFILE_SELECT });

        if (!employee) {
            // One 404 for "missing" and for "out of scope". The audit row
            // records the ambiguity honestly rather than guessing which it was:
            // distinguishing them would need a second, unscoped read.
            await logSecurityEvent({
                action: SECURITY_ACTION.ACCESS_DENIED,
                actorEmail: user.email,
                actorRole: user.role,
                target: `employee:${id}`,
                outcome: "DENIED",
                detail: { reason: "not-found-or-out-of-scope", scope: subject.department },
            });
            return NextResponse.json({ error: "Employee not found" }, { status: 404 });
        }

        return NextResponse.json({
            employee,
            // Stated rather than inferred by the client: whether the pay/bank/
            // identity block was included in this response.
            includedRestrictedFields: canViewRestricted,
        });
    } catch {
        // No stack trace, no Prisma message — a driver error has described the
        // schema to the caller often enough.
        return NextResponse.json({ error: "Could not load employee" }, { status: 500 });
    }
}
