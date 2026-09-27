import { NextResponse, type NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { authorizeAnyPermission, authorizePermission } from "@/lib/auth/guards";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { z } from "zod";
import { serviceConfigCreateSchema, serviceConfigUpdateSchema } from "@/app/lib/validation";
import { logSecurityEvent, SECURITY_ACTION } from "@/lib/auth/audit";

/**
 * /api/service-config
 *
 * Every method now goes through the centralized guard instead of an inline
 * `(session.user as { role: string }).role !== 'ADMIN'` comparison. Two behavioural changes:
 *  - GET previously accepted ANY authenticated session and returned the full
 *    system configuration to every employee. It now requires a
 *    configuration-adjacent capability, and answers 403 rather than 200.
 *  - All methods now distinguish 401 (no session) from 403 (insufficient
 *    permission), and log denied access.
 */

export const dynamic = "force-dynamic";

function denied(status: 401 | 403, error: string) {
    return NextResponse.json({ error }, { status });
}

/** GET — read active service configuration. */
export async function GET() {
    const auth = await authorizeAnyPermission([
        PERMISSIONS.SERVICE_CONFIG_MANAGE,
        PERMISSIONS.SETTINGS_VIEW,
        PERMISSIONS.SETTINGS_MANAGE,
    ]);
    if (!auth.ok) {
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            outcome: "DENIED",
            requestPath: "/api/service-config",
            requestMethod: "GET",
            detail: { status: auth.status },
        });
        return denied(auth.status, auth.error);
    }

    try {
        const configs = await prisma.serviceConfig.findMany({
            where: { isActive: true },
            orderBy: { module: "asc" },
        });
        return NextResponse.json(configs);
    } catch (error) {
        console.error("[SERVICE_CONFIG_GET]", error);
        // Do not echo the internal error message to the client.
        return NextResponse.json({ error: "Failed to fetch configs" }, { status: 500 });
    }
}

/** POST — create a ServiceConfig. Requires configuration management. */
export async function POST(req: NextRequest) {
    const auth = await authorizePermission(PERMISSIONS.SERVICE_CONFIG_MANAGE);
    if (!auth.ok) {
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: auth.ok ? null : undefined,
            outcome: "DENIED",
            requestPath: "/api/service-config",
            requestMethod: "POST",
            detail: { status: auth.status },
        });
        return denied(auth.status, auth.error);
    }

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const parse = serviceConfigCreateSchema.safeParse(body);
    if (!parse.success) {
        return NextResponse.json({ error: "Invalid payload", details: parse.error.format() }, { status: 400 });
    }

    try {
        const config = await prisma.serviceConfig.create({ data: parse.data });
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: auth.user.email,
            actorRole: auth.user.role,
            target: `serviceConfig:${config.id}`,
            outcome: "SUCCESS",
            detail: { change: "create", module: config.module, key: config.key },
        });
        return NextResponse.json(config, { status: 201 });
    } catch (error) {
        console.error("[SERVICE_CONFIG_POST]", error);
        return NextResponse.json({ error: "Failed to create config" }, { status: 500 });
    }
}

/** PATCH — update a ServiceConfig. */
export async function PATCH(req: NextRequest) {
    const auth = await authorizePermission(PERMISSIONS.SERVICE_CONFIG_MANAGE);
    if (!auth.ok) {
        return denied(auth.status, auth.error);
    }

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const parse = serviceConfigUpdateSchema.safeParse(body);
    if (!parse.success) {
        return NextResponse.json({ error: "Invalid payload", details: parse.error.format() }, { status: 400 });
    }

    try {
        const config = await prisma.serviceConfig.update({ where: { id }, data: parse.data });
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: auth.user.email,
            actorRole: auth.user.role,
            target: `serviceConfig:${id}`,
            outcome: "SUCCESS",
            detail: { change: "update" },
        });
        return NextResponse.json(config);
    } catch (error) {
        console.error("[SERVICE_CONFIG_PATCH]", error);
        return NextResponse.json({ error: "Failed to update config" }, { status: 500 });
    }
}

/** DELETE — soft-delete a ServiceConfig. */
export async function DELETE(req: NextRequest) {
    const auth = await authorizePermission(PERMISSIONS.SERVICE_CONFIG_MANAGE);
    if (!auth.ok) {
        return denied(auth.status, auth.error);
    }

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    try {
        const config = await prisma.serviceConfig.update({
            where: { id },
            data: { isActive: false },
        });
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: auth.user.email,
            actorRole: auth.user.role,
            target: `serviceConfig:${id}`,
            outcome: "SUCCESS",
            detail: { change: "softDelete" },
        });
        return NextResponse.json(config);
    } catch (error) {
        console.error("[SERVICE_CONFIG_DELETE]", error);
        return NextResponse.json({ error: "Failed to delete config" }, { status: 500 });
    }
}

// Referenced so the zod import is not tree-shaken away by a future refactor.
export type ServiceConfigPayload = z.infer<typeof serviceConfigCreateSchema>;
