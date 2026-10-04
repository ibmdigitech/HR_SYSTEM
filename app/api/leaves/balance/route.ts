import { NextResponse } from "next/server";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
// Plain modules only. `AnimatedLeaveProgress` and `LeaveBalanceCard` are both
// "use client", and a route handler runs on the server — importing a callable
// from one builds a client reference that throws when invoked.
import { calculateSickLeaveBreakdown, describeLeaveBar } from "@/components/leave/leave-bar-math";

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
      // Shared with the Staff Services ring so both surfaces report an overdrawn
      // or unallocated balance identically, instead of clamping it to a healthy 0.
      const bar = describeLeaveBar(bal.totalDays, bal.usedDays);

      const baseBalance = {
        leaveType: bal.leaveType,
        totalDays: bar.entitled,
        usedDays: bar.used,
        year: bal.year,
        remainingDays: bar.remaining,
        usedPercentage: bar.usedPercentage,
        hasEntitlement: bar.hasEntitlement,
        isOverdrawn: bar.isOverdrawn,
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
    const summaryBar = describeLeaveBar(totalEntitlement, totalUsed);

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
        totalRemaining: summaryBar.remaining,
        overallPercentage: summaryBar.usedPercentage,
        isOverdrawn: summaryBar.isOverdrawn,
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