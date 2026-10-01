import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/guards";
import { hasAnyPermission, PERMISSIONS } from "@/lib/auth/permissions";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
    const session = await getSessionUser();
    if (!session.ok) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id } = await context.params;
    const exitCase = await prisma.exitCase.findUnique({
        where: { id },
        select: {
            employeeId: true,
            type: true,
            resignationLetterData: true,
            resignationLetterName: true,
            resignationLetterType: true,
        },
    });
    if (!exitCase?.resignationLetterData || !exitCase.resignationLetterName) {
        return NextResponse.json({ error: "Letter not found" }, { status: 404 });
    }

    const mayViewAll = hasAnyPermission(session.user.role, [
        PERMISSIONS.RESIGNATION_VIEW,
        PERMISSIONS.TERMINATION_VIEW,
    ]);
    const isOwnerResignation = session.user.employeeId === exitCase.employeeId && exitCase.type === "RESIGNATION";
    if (!mayViewAll && !isOwnerResignation) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const safeName = exitCase.resignationLetterName.replace(/[\r\n"\\]/g, "_");
    return new Response(Buffer.from(exitCase.resignationLetterData), {
        headers: {
            "Content-Type": exitCase.resignationLetterType ?? "application/octet-stream",
            "Content-Disposition": `attachment; filename="${safeName}"`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    });
}
