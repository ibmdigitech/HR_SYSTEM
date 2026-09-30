'use client';

import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, AlertCircle, CheckCircle, Info } from "lucide-react";

export interface LeaveBalanceData {
  leaveType: string;
  totalDays: number;
  usedDays: number;
  year: number;
  remainingDays: number;
  usedPercentage: number;
}

export interface SickLeaveBreakdown {
  // The three statutory entitlements (UAE Labour Law sick leave: 90 days =
  // 15 full pay, 30 half pay, 45 unpaid). `calculateSickLeaveBreakdown`
  // already returns these, and the card renders "used / entitlement" for each
  // tier, so they are part of the contract — they were simply missing from
  // this interface, which made those reads a compile error.
  fullPayEntitlement: number;
  halfPayEntitlement: number;
  unpaidEntitlement: number;
  totalEntitlement: number;
  usedFullPay: number;
  usedHalfPay: number;
  usedUnpaid: number;
  remainingFullPay: number;
  remainingHalfPay: number;
  remainingUnpaid: number;
}

/**
 * Calculates UAE Labour Law sick leave breakdown
 * 90 days total: 15 full pay, 30 half pay, 45 unpaid
 */
export function calculateSickLeaveBreakdown(
  usedDays: number,
  totalDays: number = 90
): SickLeaveBreakdown {
  const fullPayEntitlement = 15;
  const halfPayEntitlement = 30;
  const unpaidEntitlement = 45;

  let usedFullPay = 0;
  let usedHalfPay = 0;
  let usedUnpaid = 0;

  let remaining = usedDays;

  // First deduct from full pay
  usedFullPay = Math.min(remaining, fullPayEntitlement);
  remaining -= usedFullPay;

  // Then deduct from half pay
  usedHalfPay = Math.min(remaining, halfPayEntitlement);
  remaining -= usedHalfPay;

  // Rest is unpaid
  usedUnpaid = remaining;

  return {
    fullPayEntitlement,
    halfPayEntitlement,
    unpaidEntitlement,
    totalEntitlement: totalDays,
    usedFullPay,
    usedHalfPay,
    usedUnpaid,
    remainingFullPay: Math.max(0, fullPayEntitlement - usedFullPay),
    remainingHalfPay: Math.max(0, halfPayEntitlement - usedHalfPay),
    remainingUnpaid: Math.max(0, unpaidEntitlement - usedUnpaid),
  };
}

/**
 * Gets color based on usage percentage
 */
export function getProgressColor(percentage: number): string {
  if (percentage >= 90) return "bg-rose-500";
  if (percentage >= 70) return "bg-amber-500";
  if (percentage >= 50) return "bg-blue-500";
  return "bg-emerald-500";
}

/**
 * Gets background color for the progress track based on usage
 */
export function getProgressTrackColor(percentage: number): string {
  if (percentage >= 90) return "bg-rose-100 dark:bg-rose-900/30";
  if (percentage >= 70) return "bg-amber-100 dark:bg-amber-900/30";
  if (percentage >= 50) return "bg-blue-100 dark:bg-blue-900/30";
  return "bg-emerald-100 dark:bg-emerald-900/30";
}

/**
 * Leave Balance Card with Progress Bar and Count Inside
 */
export function LeaveBalanceCard({
  leaveType,
  totalDays,
  usedDays,
  year,
  showSickBreakdown = false,
}: {
  leaveType: string;
  totalDays: number;
  usedDays: number;
  year: number;
  showSickBreakdown?: boolean;
}) {
  const remainingDays = Math.max(0, totalDays - usedDays);
  const usedPercentage = totalDays > 0 ? Math.min(100, Math.round((usedDays / totalDays) * 100)) : 0;
  const progressColor = getProgressColor(usedPercentage);
  const trackColor = getProgressTrackColor(usedPercentage);

  const isSickLeave = leaveType === 'SICK';
  const sickBreakdown = isSickLeave ? calculateSickLeaveBreakdown(usedDays, totalDays) : null;

  return (
    <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 space-y-4 transition-all hover:shadow-md">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h4 className="font-black text-sm text-slate-800 dark:text-slate-200 uppercase tracking-tight">
            {leaveType}
            {isSickLeave && (
              <span className="ml-2 px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 rounded">
                UAE Law
              </span>
            )}
          </h4>
          <span className="text-[10px] text-slate-400 font-bold">Year {year}</span>
        </div>
        <Badge 
          className={`font-black text-[10px] px-2.5 py-1 rounded-full border-0 ${
            usedPercentage >= 90 
              ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
              : usedPercentage >= 70
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
              : 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
          }`}
        >
          {remainingDays} / {totalDays} Left
        </Badge>
      </div>

      {/* Progress Bar with Count Inside */}
      <div className="relative">
        <div 
          className={`h-6 rounded-full overflow-hidden ${trackColor} relative`}
          style={{ minWidth: '100%' }}
        >
          <div
            className={`h-full ${progressColor} transition-all duration-500 flex items-center justify-center`}
            style={{ width: `${usedPercentage}%` }}
          >
            <span className="text-[10px] font-black text-white drop-shadow-sm whitespace-nowrap px-1">
              {usedDays} / {totalDays} Used ({usedPercentage}%)
            </span>
          </div>
          
          {/* Remaining portion indicator */}
          {usedPercentage < 100 && (
            <div
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-600 dark:text-slate-400 whitespace-nowrap"
              style={{ right: `${Math.max(0, 100 - usedPercentage - 2)}%` }}
            >
              {remainingDays} Left
            </div>
          )}
        </div>
        
        {/* Progress labels */}
        <div className="flex justify-between text-[9px] text-slate-400 font-bold uppercase mt-1">
          <span>Used: {usedDays} Days</span>
          <span>{usedPercentage}% Used</span>
          <span className={usedPercentage >= 90 ? 'text-rose-500' : ''}>
            {remainingDays} Remaining
          </span>
        </div>
      </div>

      {/* Sick Leave UAE Law Breakdown */}
      {isSickLeave && showSickBreakdown && sickBreakdown && (
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-3">
          <p className="text-xs font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1">
            <Info className="h-3 w-3" />
            UAE Labour Law: 90 days sick leave per year (15 full pay, 30 half pay, 45 unpaid)
          </p>
          
          <div className="grid grid-cols-3 gap-2">
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/30">
              <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 mb-1">
                <CheckCircle className="h-3 w-3" />
                Full Pay
              </div>
              <div className="text-2xl font-black text-emerald-800 dark:text-emerald-300">
                {sickBreakdown.remainingFullPay}
              </div>
              <div className="text-[9px] text-emerald-600 dark:text-emerald-500">
                {sickBreakdown.usedFullPay} / {sickBreakdown.fullPayEntitlement} used
              </div>
            </div>
            
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/30">
              <div className="flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-400 mb-1">
                <AlertCircle className="h-3 w-3" />
                Half Pay
              </div>
              <div className="text-2xl font-black text-amber-800 dark:text-amber-300">
                {sickBreakdown.remainingHalfPay}
              </div>
              <div className="text-[9px] text-amber-600 dark:text-amber-500">
                {sickBreakdown.usedHalfPay} / {sickBreakdown.halfPayEntitlement} used
              </div>
            </div>
            
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-900/30">
              <div className="flex items-center gap-1 text-[10px] font-bold text-rose-700 dark:text-rose-400 mb-1">
                <CalendarDays className="h-3 w-3" />
                Unpaid
              </div>
              <div className="text-2xl font-black text-rose-800 dark:text-rose-300">
                {sickBreakdown.remainingUnpaid}
              </div>
              <div className="text-[9px] text-rose-600 dark:text-rose-500">
                {sickBreakdown.usedUnpaid} / {sickBreakdown.unpaidEntitlement} used
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Other leave types summary */}
      {!isSickLeave && (
        <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400 font-medium">
          <span>Entitlement: {totalDays} days</span>
          <span>Used: {usedDays} days</span>
          <span className={remainingDays <= 2 ? 'text-rose-500 font-black' : ''}>
            Remaining: {remainingDays} days
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Leave Balance Grid - displays all leave balances in a responsive grid
 */
export function LeaveBalanceGrid({ 
  balances, 
  showSickBreakdown = true 
}: { 
  balances: LeaveBalanceData[]; 
  showSickBreakdown?: boolean;
}) {
  if (!balances || balances.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400 dark:text-slate-500">
        <CalendarDays className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p className="font-medium">No leave allocations found</p>
        <p className="text-sm mt-1">Contact HR to provision your leave balances</p>
      </div>
    );
  }

  // Sort: SICK first (UAE Law), then ANNUAL, then others alphabetically
  const sortedBalances = [...balances].sort((a, b) => {
    if (a.leaveType === 'SICK') return -1;
    if (b.leaveType === 'SICK') return 1;
    if (a.leaveType === 'ANNUAL') return -1;
    if (b.leaveType === 'ANNUAL') return 1;
    return a.leaveType.localeCompare(b.leaveType);
  });

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {sortedBalances.map((bal) => (
        <LeaveBalanceCard
          key={`${bal.leaveType}-${bal.year}`}
          leaveType={bal.leaveType}
          totalDays={bal.totalDays}
          usedDays={bal.usedDays}
          year={bal.year}
          showSickBreakdown={showSickBreakdown}
        />
      ))}
    </div>
  );
}

/**
 * Summary Card showing overall leave statistics
 */
export function LeaveSummaryCard({ balances }: { balances: LeaveBalanceData[] }) {
  const totalEntitlement = balances.reduce((sum, b) => sum + b.totalDays, 0);
  const totalUsed = balances.reduce((sum, b) => sum + b.usedDays, 0);
  const totalRemaining = Math.max(0, totalEntitlement - totalUsed);
  const overallPercentage = totalEntitlement > 0 ? Math.round((totalUsed / totalEntitlement) * 100) : 0;

  return (
    <div className="p-6 rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-800 text-white space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-indigo-100 uppercase tracking-wider">Total Leave Balance</p>
          <h3 className="text-3xl font-black mt-1">{totalRemaining} Days Remaining</h3>
        </div>
        <div className="p-3 bg-white/10 backdrop-blur-sm rounded-xl">
          <CalendarDays className="h-8 w-8 text-indigo-200" />
        </div>
      </div>

      <div className="relative h-3 bg-white/20 rounded-full overflow-hidden">
        <div
          className="h-full bg-white transition-all duration-500 flex items-center justify-center"
          style={{ width: `${overallPercentage}%` }}
        >
          <span className="text-xs font-black text-indigo-900 whitespace-nowrap px-2">
            {totalUsed} / {totalEntitlement} Used ({overallPercentage}%)
          </span>
        </div>
      </div>

      <div className="flex justify-between text-sm text-indigo-100">
        <span>Total Entitlement: {totalEntitlement} days</span>
        <span>Used: {totalUsed} days</span>
        <span className="font-bold">{totalRemaining} days left</span>
      </div>
    </div>
  );
}