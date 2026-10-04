import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/guards";
import { hasAnyPermission, PERMISSIONS } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
    const session = await getSessionUser();
    if (!session.ok) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!hasAnyPermission(session.user.role, [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_MANAGE])) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { id } = await context.params;
    const document = await prisma.companyDocument.findUnique({
        where: { id },
        select: { fileData: true, fileName: true, fileUrl: true },
    });
    if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (!document.fileData) {
        if (document.fileUrl.startsWith("https://")) return NextResponse.redirect(document.fileUrl);
        return NextResponse.json({ error: "Document file not found" }, { status: 404 });
    }

    const safeName = document.fileName.replace(/[\r\n"\\]/g, "_");
    return new Response(Buffer.from(document.fileData), {
        headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${safeName}"`,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    });
}
