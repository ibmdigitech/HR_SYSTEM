import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/guards";
import { hasAnyPermission, PERMISSIONS } from "@/lib/auth/permissions";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(request: Request) {
  try {
    const session = await getSessionUser();
    if (!session.ok) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    if (!hasAnyPermission(session.user.role, [PERMISSIONS.EMPLOYEES_CREATE, PERMISSIONS.EMPLOYEES_EDIT])) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const category = formData.get("category") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!category) {
      return NextResponse.json({ error: "Category is required" }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: `File type not allowed. Allowed types: ${ALLOWED_MIME_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Create unique filename
    const ext = path.extname(file.name) || ".bin";
    const uniqueName = `${category.toLowerCase()}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}${ext}`;
    const uploadDir = path.join(process.cwd(), "public", "uploads", "employees");
    
    await mkdir(uploadDir, { recursive: true });
    const filePath = path.join(uploadDir, uniqueName);

    await writeFile(filePath, buffer);

    // Return the public URL
    const fileUrl = `/uploads/employees/${uniqueName}`;

    return NextResponse.json({
      success: true,
      fileUrl,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    });
  } catch (error) {
    console.error("File upload failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 }
    );
  }
}
