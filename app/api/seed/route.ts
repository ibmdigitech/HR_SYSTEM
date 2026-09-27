import { NextResponse, type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import prisma from "@/lib/prisma";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";

/**
 * API-010 remediation.
 *
 * Original state: a public `GET` handler with no authentication of any kind
 * that upserted an ADMIN user (with a literal placeholder string as the
 * password hash, so any account it created could never sign in) and three
 * letter templates. Being a GET, it was also reachable by link prefetch and by
 * any crawler, not just by deliberate POST.
 *
 * Why the endpoint still exists: the letter templates it creates are reference
 * data the app reads. Deleting the route outright would remove that data path.
 * Instead the route is fenced:
 *
 *   1. Refuses to run in production — unconditionally, before any DB work.
 *   2. Refuses to run without a valid session.
 *   3. Requires SUPER_ADMIN via the centralized guard.
 *   4. Requires an explicit confirmation token in the request body/query, so it
 *      can never fire as a side effect of a stray GET, prefetch or crawler.
 *   5. Uses a real bcrypt hash.
 *   6. Logs every outcome, allowed or denied.
 *
 * The supported way to seed remains the CLI script `npm run seed`.
 */

export const dynamic = "force-dynamic";

/** Confirmation value required in the query string. */
const CONFIRMATION = "SEED";

/** Password assigned to a newly created development admin. */
const DEV_ADMIN_PASSWORD = "password123";

type Outcome = "ALLOWED" | "DENIED_PRODUCTION" | "DENIED_UNAUTHENTICATED" | "DENIED_FORBIDDEN" | "DENIED_UNCONFIRMED" | "ERROR";

function respond(outcome: Outcome, status: number, body: Record<string, unknown>) {
    return NextResponse.json({ ...body, outcome }, { status });
}

export async function GET(req: NextRequest) {
    // 1. Production is a hard stop, evaluated before any database access.
    if (process.env.NODE_ENV === "production") {
        await logSecurityEvent({
            action: SECURITY_ACTION.SEED_DENIED,
            outcome: "DENIED",
            requestPath: "/api/seed",
            requestMethod: "GET",
            detail: { reason: "production environment" },
        });
        // Generic message: do not disclose that seeding exists in this build.
        return respond("DENIED_PRODUCTION", 404, { error: "Not found" });
    }

    // 2. Authentication.
    const { getSessionUser } = await import("@/lib/auth/guards");
    const session = await getSessionUser();
    if (!session.ok) {
        await logSecurityEvent({
            action: SECURITY_ACTION.SEED_DENIED,
            outcome: "DENIED",
            requestPath: "/api/seed",
            requestMethod: "GET",
            detail: { reason: session.reason },
        });
        return respond("DENIED_UNAUTHENTICATED", 401, { error: "Authentication required" });
    }

    // 3. Authorization — SUPER_ADMIN only, via the centralized guard.
    if (session.user.role !== "SUPER_ADMIN") {
        await logSecurityEvent({
            action: SECURITY_ACTION.SEED_DENIED,
            actorEmail: session.user.email,
            actorRole: session.user.role,
            outcome: "DENIED",
            requestPath: "/api/seed",
            requestMethod: "GET",
            detail: { reason: "insufficient role", required: "SUPER_ADMIN" },
        });
        return respond("DENIED_FORBIDDEN", 403, { error: "Insufficient permissions" });
    }

    // 4. Explicit confirmation — prevents prefetch / crawler / stray-GET writes.
    const confirm = req.nextUrl.searchParams.get("confirm");
    if (confirm !== CONFIRMATION) {
        await logSecurityEvent({
            action: SECURITY_ACTION.SEED_DENIED,
            actorEmail: session.user.email,
            actorRole: session.user.role,
            outcome: "DENIED",
            requestPath: "/api/seed",
            requestMethod: "GET",
            detail: { reason: "missing confirmation" },
        });
        return respond("DENIED_UNCONFIRMED", 400, {
            error: `This endpoint requires an explicit confirmation. Use POST with confirm=${CONFIRMATION}, or prefer: npm run seed`,
        });
    }

    return performSeed(session.user.email, session.user.role, req);
}

export async function POST(req: NextRequest) {
    if (process.env.NODE_ENV === "production") {
        await logSecurityEvent({
            action: SECURITY_ACTION.SEED_DENIED,
            outcome: "DENIED",
            requestPath: "/api/seed",
            requestMethod: "POST",
            detail: { reason: "production environment" },
        });
        return respond("DENIED_PRODUCTION", 404, { error: "Not found" });
    }

    const { getSessionUser } = await import("@/lib/auth/guards");
    const session = await getSessionUser();
    if (!session.ok) {
        await logSecurityEvent({
            action: SECURITY_ACTION.SEED_DENIED,
            outcome: "DENIED",
            requestPath: "/api/seed",
            requestMethod: "POST",
            detail: { reason: session.reason },
        });
        return respond("DENIED_UNAUTHENTICATED", 401, { error: "Authentication required" });
    }

    if (session.user.role !== "SUPER_ADMIN") {
        await logSecurityEvent({
            action: SECURITY_ACTION.SEED_DENIED,
            actorEmail: session.user.email,
            actorRole: session.user.role,
            outcome: "DENIED",
            requestPath: "/api/seed",
            requestMethod: "POST",
            detail: { reason: "insufficient role", required: "SUPER_ADMIN" },
        });
        return respond("DENIED_FORBIDDEN", 403, { error: "Insufficient permissions" });
    }

    const confirm = req.nextUrl.searchParams.get("confirm") ?? req.headers.get("x-seed-confirmation");
    if (confirm !== CONFIRMATION) {
        return respond("DENIED_UNCONFIRMED", 400, {
            error: `This endpoint requires an explicit confirmation. Use POST with confirm=${CONFIRMATION}, or prefer: npm run seed`,
        });
    }

    return performSeed(session.user.email, session.user.role, req);
}

async function performSeed(actorEmail: string, actorRole: string, req: NextRequest) {
    try {
        // A real bcrypt hash — the previous literal placeholder produced an
        // account that could never authenticate.
        const hashed = await bcrypt.hash(DEV_ADMIN_PASSWORD, 10);

        const user = await prisma.user.upsert({
            where: { email: "admin@company.com" },
            // Never overwrite an existing password on re-run.
            update: {},
            create: {
                email: "admin@company.com",
                password: hashed,
                role: "ADMIN",
                name: "Admin User",
            },
            select: { id: true, email: true, role: true },
        });

        const templates = [
            {
                name: "Salary Certificate",
                type: "SALARY_CERTIFICATE",
                content_en:
                    "To Whom It May Concern,\n\nThis is to certify that {{employee.name}} is employed by Al Barakah Group as {{employee.designation}} since {{employee.joiningDate}}.\n\nHis current monthly salary is AED {{salary.total}}.\n\nThis certificate is issued at the employee's request without any liability on the part of the company.",
                content_ar:
                    "إلى من يهمه الأمر،\n\nنشهد بموجب هذه الوثيقة أن السيد/ {{employee.name}} يعمل لدى مجموعة البركة بمهنة {{employee.designation}} منذ تاريخ {{employee.joiningDate}}.\n\nراتبه الشهري الإجمالي الحالي هو {{salary.total}} درهم إماراتي.\n\nتم إصدار هذه الشهادة بناءً على طلب الموظف دون أدنى مسؤولية على الشركة.",
            },
            {
                name: "No Objection Certificate",
                type: "NOC",
                content_en:
                    "To Whom It May Concern,\n\nAl Barakah Group has no objection for {{employee.name}} (Emirates ID: {{employee.emiratesId}}) to apply for {{request.purpose}}.\n\nThis NOC is valid for 30 days from the date of issue.",
                content_ar:
                    "إلى من يهمه الأمر،\n\nتفيد مجموعة البركة بأنه لا مانع لديها من قيام السيد/ {{employee.name}} (رقم الهوية: {{employee.emiratesId}}) بالتقدم بطلب {{request.purpose}}.\n\nهذه الشهادة صالحة لمدة 30 يوماً من تاريخ الإصدار.",
            },
            {
                name: "Offer Letter",
                type: "OFFER",
                content_en:
                    "Dear Candidate,\n\nWe are pleased to offer you the position of {{employee.designation}} at Al Barakah Group.\n\nYour joining date is set for {{employee.joiningDate}} with a starting salary of AED {{salary.total}} per month.",
                content_ar:
                    "عزيزي المرشح،\n\nيسرنا أن نعرض عليك وظيفة {{employee.designation}} في مجموعة البركة.\n\nتم تحديد تاريخ انضمامك في {{employee.joiningDate}} براتب أساسي قدره {{salary.total}} درهم إماراتي شهرياً.",
            },
        ];

        // Idempotent: keyed on a stable id, so re-running updates rather than
        // duplicating.
        let templatesUpserted = 0;
        for (const t of templates) {
            const id = t.name.replace(/\s+/g, "_").toLowerCase();
            await prisma.letterTemplate.upsert({
                where: { id },
                update: { name: t.name, type: t.type, content_en: t.content_en, content_ar: t.content_ar },
                create: { id, ...t },
            });
            templatesUpserted++;
        }

        await logSecurityEvent({
            action: SECURITY_ACTION.SEED_EXECUTED,
            actorEmail,
            actorRole,
            target: "database-seed",
            outcome: "SUCCESS",
            requestPath: "/api/seed",
            requestMethod: req.method,
            detail: { templatesUpserted, adminEmail: user.email },
        });

        return respond("ALLOWED", 200, {
            message: "Development seed completed",
            admin: { email: user.email, role: user.role },
            templatesUpserted,
        });
    } catch (error) {
        await logSecurityEvent({
            action: SECURITY_ACTION.SEED_EXECUTED,
            actorEmail,
            actorRole,
            outcome: "ERROR",
            requestPath: "/api/seed",
            requestMethod: req.method,
            detail: { message: error instanceof Error ? (error instanceof Error ? error.message : "Unknown error") : "unknown" },
        });
        // No stack trace, no database detail in the response.
        return respond("ERROR", 500, { error: "Seed failed" });
    }
}
