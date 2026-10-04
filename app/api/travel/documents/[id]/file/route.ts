import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { readTravelDocument } from "@/lib/workflow/business-travel";

export const dynamic = "force-dynamic";

/**
 * Serves one travel document's bytes.
 *
 * WHY A ROUTE AND NOT A PUBLIC FILE: a boarding pass carries a passport number
 * and a seat number. Writing it under `public/uploads` would make it readable by
 * anyone who guessed the filename, so the bytes live in the database and are
 * released here, one at a time, after the same scope test the rest of the
 * travel feature uses. A document the caller may not see answers 404 rather than
 * 403, so the endpoint cannot be used to discover which ids exist.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
    const session = await getSessionUser();
    if (!session.ok) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { id } = await context.params;
    const document = await readTravelDocument(session.subject, id);
    if (!document) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const payload = /^data:[\w.+-]+\/[\w.+-]+;base64,(.+)$/.exec(document.fileUrl);
    if (!payload) return NextResponse.json({ error: "Document file not found" }, { status: 404 });

    // Strip anything that could break out of the header or the filesystem if the
    // name is ever reused: the value is user-supplied.
    const safeName = document.fileName.replace(/[\r\n"\\]/g, "_");
    return new Response(Buffer.from(payload[1], "base64"), {
        headers: {
            "Content-Type": document.fileType,
            "Content-Disposition": `inline; filename="${safeName}"`,
            "Content-Length": String(Buffer.byteLength(payload[1], "base64")),
            // A boarding pass must not sit in a shared cache.
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    });
}