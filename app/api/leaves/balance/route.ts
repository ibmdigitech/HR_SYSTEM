import { NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { calculateSickLeaveBreakdown } from "@/components/leave/LeaveBalanceCard";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: {
        employee: {
          include: {
            leaveBalances: {
              orderBy: [{ leaveType: "asc" }, { year: "desc" }],
            },
          },
        },
      },
    });

    if (!user?.employee) {
      return NextResponse.json({ error: "Employee profile not found" }, { status: 404 });
    }

    const currentYear = new Date().getFullYear();
    const balances = user.employee.leaveBalances.map((bal) => {
      const remainingDays = Math.max(0, bal.totalDays - bal.usedDays);
      const usedPercentage = bal.totalDays > 0 ? Math.min(100, Math.round((bal.usedDays / bal.totalDays) * 100)) : 0;

      const baseBalance = {
        leaveType: bal.leaveType,
        totalDays: bal.totalDays,
        usedDays: bal.usedDays,
        year: bal.year,
        remainingDays,
        usedPercentage,
      };

      // Add UAE Labour Law sick leave breakdown
      if (bal.leaveType === "SICK") {
        const breakdown = calculateSickLeaveBreakdown(bal.usedDays, bal.totalDays);
        return {
          ...baseBalance,
          sickBreakdown: breakdown,
        };
      }

      return baseBalance;
    });

    // Calculate summary
    const totalEntitlement = balances.reduce((sum, b) => sum + b.totalDays, 0);
    const totalUsed = balances.reduce((sum, b) => sum + b.usedDays, 0);
    const totalRemaining = Math.max(0, totalEntitlement - totalUsed);
    const overallPercentage = totalEntitlement > 0 ? Math.round((totalUsed / totalEntitlement) * 100) : 0;

    return NextResponse.json({
      employee: {
        id: user.employee.id,
        employeeCode: user.employee.employeeCode,
        firstName: user.employee.firstName,
        lastName: user.employee.lastName,
        department: user.employee.department,
        designation: user.employee.designation,
      },
      balances,
      summary: {
        totalEntitlement,
        totalUsed,
        totalRemaining,
        overallPercentage,
        currentYear,
      },
      uaeLabourLaw: {
        annualLeave: "30 days per year (after 1 year continuous service)",
        sickLeave: "90 days per year: 15 full pay, 30 half pay, 45 unpaid",
        maternityLeave: "60 days: 45 full pay + 15 half pay",
        paternityLeave: "5 days",
        hajjLeave: "30 days (once during service)",
        bereavementLeave: "3 days (immediate family)",
      },
    });
  } catch (error) {
    console.error("[LEAVE_BALANCE_API_ERROR]", error);
    return NextResponse.json(
      { error: "Failed to fetch leave balances" },
      { status: 500 }
    );
  }
}