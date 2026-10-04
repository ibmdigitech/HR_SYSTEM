/**
 * Leave-balance ring geometry.
 *
 * WHY THIS IS NOT IN `AnimatedLeaveProgress.tsx`
 *
 * That file is a `"use client"` module. A server component may IMPORT from a
 * client module but may not CALL anything in it — the binding exists only as a
 * client-side reference, so invoking it during a server render throws
 *
 *   "Attempted to call describeLeaveBar() from the server but
 *    describeLeaveBar is on the client."
 *
 * Both callers that need this function outside the browser are server-side: the
 * `/staff-services` page, which precomputes the bar state to render the summary
 * text, and `app/api/leaves/balance`, which returns it over HTTP. Keeping the
 * function here — a plain module with no directive — is what makes it callable
 * from both, while the client component imports it unchanged.
 *
 * The alternative, duplicating the arithmetic per caller, is exactly how the
 * two states below drifted apart in the first place: the page clamped remaining
 * to zero and the ring did not, so an overdrawn balance read "healthy" in the
 * summary and "full" in the graphic.
 */

const RADIUS = 44;

/** Ring radius. Exported so the SVG geometry and the maths cannot drift apart. */
export const LEAVE_RING_RADIUS = RADIUS;

/** Circumference of the ring at `RADIUS`. Shared so the SVG and the maths agree. */
export const LEAVE_RING_CIRCUMFERENCE = 2 * Math.PI * RADIUS;

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
 *
 * Lives here, not in `LeaveBalanceCard.tsx`, for the same reason as
 * `describeLeaveBar`: that file is `"use client"`, and `app/api/leaves/balance`
 * calls this from a route handler on the server.
 */
export function calculateSickLeaveBreakdown(
    usedDays: number,
    totalDays: number = 90
): SickLeaveBreakdown {
    const fullPayEntitlement = 15;
    const halfPayEntitlement = 30;
    const unpaidEntitlement = 45;

    let remaining = usedDays;

    // First deduct from full pay, then half pay; whatever is left is unpaid.
    const usedFullPay = Math.min(remaining, fullPayEntitlement);
    remaining -= usedFullPay;

    const usedHalfPay = Math.min(remaining, halfPayEntitlement);
    remaining -= usedHalfPay;

    const usedUnpaid = remaining;

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

export interface LeaveBarState {
    /** Days the employee was entitled to. Never negative, never NaN. */
    entitled: number;
    /** Days actually taken. Never negative, never NaN. */
    used: number;
    /** entitled - used. Negative when overdrawn — deliberately NOT clamped to 0. */
    remaining: number;
    /** 0-100 and always finite, so it can never become `width: NaN%`. */
    usedPercentage: number;
    /** entitled > 0: there is a real allocation to fill the ring against. */
    hasEntitlement: boolean;
    /** used > entitled: the ring is full and an over-cap marker is shown. */
    isOverdrawn: boolean;
    /** A non-finite input reached the bar; rendered as an explicit data error. */
    isInvalid: boolean;
}

function finiteOrNull(value: number): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Single source of truth for leave-balance ring geometry.
 *
 * Two states used to be flattened into "an empty bar that looks broken":
 *
 *  1. `entitled === 0` — UNPAID leave (see `lib/workflow/leave.ts`, which records
 *     usage against a zero-entitlement row) and any policy with no entitlement.
 *     `used / 0` is `NaN` or `Infinity`; `NaN` reaches the SVG as an invalid
 *     `stroke-dashoffset`, which the browser discards, leaving the offset at its
 *     default of 0 and drawing a *full* ring for an unused balance.
 *  2. `used > entitled` — `Math.max(0, entitled - used)` reported the overdrawn
 *     balance as healthy, so the overspend never reached the screen or the aria
 *     value.
 *
 * Both are reported as distinct states here rather than clamped away.
 */
export function describeLeaveBar(totalDays: number, usedDays: number): LeaveBarState {
    const rawEntitled = finiteOrNull(totalDays);
    const rawUsed = finiteOrNull(usedDays);
    const isInvalid = rawEntitled === null || rawUsed === null;

    const entitled = Math.max(0, rawEntitled ?? 0);
    const used = Math.max(0, rawUsed ?? 0);
    const remaining = entitled - used;
    const isOverdrawn = remaining < 0;

    // `entitled > 0` guards the only division, so the ratio — and therefore the
    // percentage handed to `strokeDashoffset` — is always finite.
    const usedPercentage =
        entitled > 0
            ? Math.min(100, Math.max(0, Math.round((used / entitled) * 100)))
            : isOverdrawn
              ? 100
              : 0;

    return {
        entitled,
        used,
        remaining,
        usedPercentage,
        hasEntitlement: entitled > 0,
        isOverdrawn,
        isInvalid,
    };
}