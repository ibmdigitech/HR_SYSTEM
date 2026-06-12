import prisma from "@/lib/prisma"
import { NextResponse } from "next/server"
import { auth } from "@/auth"

export async function POST(req: Request) {
  const session = await auth()

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  })

  const { id, status } = await req.json()

  let data: any = {}

  if (user?.role === "MANAGER") {
    data.managerStatus = status
  } else if (user?.role === "HR" || user?.role === "ADMIN") {
    data.hrStatus = status
  } else {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  await prisma.leaveRequest.update({
    where: { id },
    data,
  })

  return NextResponse.json({ success: true })
}
