import { NextResponse, type NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { authorizeAnyPermission, authorizePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";

/**
 * /api/configs
 *
 * Replaces the inline `(session.user as { role?: unknown }).role !== 'ADMIN'` comparisons with
 * the centralized guard. Behaviour changes:
 *  - a missing permission now returns 403 instead of being reported as 401,
 *    so a caller can distinguish "sign in" from "you may not";
 *  - writes are validated with an explicit allow-list instead of destructuring
 *    an arbitrary JSON body straight into Prisma (mass-assignment guard);
 *  - denied access is recorded in the security audit log.
 */

export const dynamic = "force-dynamic";

const WRITE_FIELDS = ["module", "key", "value", "label", "description", "type", "options"] as const;
const MAX_FIELD_LENGTH = 2000;

function denied(status: 401 | 403, error: string) {
    return NextResponse.json({ error }, { status });
}

/** GET — read active configuration. */
export async function GET(request: NextRequest) {
    const auth = await authorizeAnyPermission([
        PERMISSIONS.SERVICE_CONFIG_MANAGE,
        PERMISSIONS.SETTINGS_VIEW,
        PERMISSIONS.SETTINGS_MANAGE,
    ]);
    if (!auth.ok) {
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            outcome: "DENIED",
            requestPath: "/api/configs",
            requestMethod: "GET",
            detail: { status: auth.status },
        });
        return denied(auth.status, auth.error);
    }

    // Named `moduleKey`, not `module`: `module` is a CommonJS global, and
    // shadowing it breaks server-action and route registration in Next.js
    // (@next/next/no-assign-module-variable).
    const moduleKey = request.nextUrl.searchParams.get("module");
    if (moduleKey && moduleKey.length > MAX_FIELD_LENGTH) {
        return NextResponse.json({ error: "Invalid module filter" }, { status: 400 });
    }

    try {
        const configs = await prisma.serviceConfig.findMany({
            where: moduleKey ? { module: moduleKey, isActive: true } : { isActive: true },
            orderBy: { key: "asc" },
        });
        return NextResponse.json(configs);
    } catch (error) {
        console.error("[CONFIGS_GET]", error);
        return NextResponse.json({ error: "Failed to fetch configurations" }, { status: 500 });
    }
}

/** POST — upsert a configuration entry. */
export async function POST(request: NextRequest) {
    const auth = await authorizePermission(PERMISSIONS.SERVICE_CONFIG_MANAGE);
    if (!auth.ok) {
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            outcome: "DENIED",
            requestPath: "/api/configs",
            requestMethod: "POST",
            detail: { status: auth.status },
        });
        return denied(auth.status, auth.error);
    }

    let body: Record<string, unknown>;
    try {
        body = (await request.json()) as Record<string, unknown>;
    } catch {
        return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    // Explicit allow-list: only known columns are ever written.
    const data: Record<string, unknown> = {};
    for (const field of WRITE_FIELDS) {
        if (body[field] === undefined) continue;
        const value = body[field];
        if (typeof value === "string" && value.length > MAX_FIELD_LENGTH) {
            return NextResponse.json({ error: `Field '${field}' is too long` }, { status: 400 });
        }
        data[field] = value;
    }

    if (typeof data.module !== "string" || typeof data.key !== "string") {
        return NextResponse.json({ error: "'module' and 'key' are required" }, { status: 400 });
    }
    if (typeof data.label !== "string" || typeof data.type !== "string") {
        return NextResponse.json({ error: "'label' and 'type' are required" }, { status: 400 });
    }

    const id = typeof body.id === "string" ? body.id : null;
    if (id) data.id = id;

    try {
        const config = await prisma.serviceConfig.upsert({
            where: id ? { id } : { module_key: { module: data.module as string, key: data.key as string } },
            update: {
                value: String(data.value ?? ""),
                label: data.label as string,
                description: (data.description as string | undefined) ?? null,
                type: data.type as string,
                options: (data.options as object | undefined) ?? undefined,
                updatedAt: new Date(),
            },
            create: {
                module: data.module as string,
                key: data.key as string,
                label: data.label as string,
                description: (data.description as string | undefined) ?? null,
                type: data.type as string,
                value: String(data.value ?? ""),
                options: (data.options as object | undefined) ?? undefined,
            },
        });

        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: auth.user.email,
            actorRole: auth.user.role,
            target: `serviceConfig:${config.id}`,
            outcome: "SUCCESS",
            detail: { change: "upsert", module: config.module, key: config.key },
        });

        return NextResponse.json(config);
    } catch (error) {
        console.error("[CONFIGS_POST]", error);
        return NextResponse.json({ error: "Failed to update configuration" }, { status: 500 });
    }
}
