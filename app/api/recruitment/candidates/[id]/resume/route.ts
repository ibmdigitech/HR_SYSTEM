import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/guards";
import { hasAnyPermission, PERMISSIONS } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
    const session = await getSessionUser();
    if (!session.ok) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!hasAnyPermission(session.user.role, [PERMISSIONS.RECRUITMENT_VIEW, PERMISSIONS.RECRUITMENT_CREATE, PERMISSIONS.RECRUITMENT_INTERVIEW])) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { id } = await context.params;
    const candidate = await prisma.candidate.findUnique({
        where: { id },
        select: { resumeData: true, resumeFileName: true },
    });
    if (!candidate?.resumeData) return NextResponse.json({ error: "Resume not found" }, { status: 404 });

    const safeName = (candidate.resumeFileName ?? "resume.pdf").replace(/[\r\n"\\]/g, "_");
    return new Response(Buffer.from(candidate.resumeData), {
        headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${safeName}"`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    });
}
