import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { LeaveApprovalTable } from "@/components/leaves/approval-table";

export default async function LeavesPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const leaves = await prisma.leaveRequest.findMany({
    include: {
      user: {
        select: { name: true, email: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Leave Management</h1>
      </div>
      
      <div className="rounded-md border bg-white">
        <LeaveApprovalTable 
          data={leaves} 
          userRole={session.user.role} 
        />
      </div>
    </div>
  );
}
# 🚀 IBM DIGITECH HRMS - PRO VERSION

## 📌 Overview
This is the enterprise-grade **Human Resource Management System (HRMS)** designed for automated employee lifecycle management, payroll processing, and role-based approval workflows.

## 🛠️ Tech Stack
- **Framework:** Next.js 15+ (App Router)
- **Language:** TypeScript
- **Database:** SQLite / PostgreSQL (via Prisma ORM)
- **Auth:** NextAuth.js v5 (Beta)
- **UI:** Tailwind CSS + Shadcn UI
- **State Management:** React Server Components & Actions

---
# hrms
hr app
