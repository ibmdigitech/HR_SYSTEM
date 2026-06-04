import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { importAttendanceFromCsv } from "@/app/lib/actions/attendance-import";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".csv")) {
      return NextResponse.json(
        { error: "Only CSV files are supported. Please upload a .csv file." },
        { status: 400 }
      );
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 5MB." },
        { status: 400 }
      );
    }

    const result = await importAttendanceFromCsv(formData);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[ATTENDANCE_IMPORT_ERROR]", error);
    return NextResponse.json(
      { error: error.message || "Failed to import attendance data" },
      { status: 500 }
    );
  }
}
