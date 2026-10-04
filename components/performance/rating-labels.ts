/**
 * Rating scale shared by the performance review detail page and the rating
 * widgets.
 *
 * WHY A SEPARATE MODULE
 *
 * `PerformanceFeedback.tsx` is a `"use client"` module, and
 * `app/performance/reviews/[id]/page.tsx` is an async Server Component that
 * reads this map to label a goal's saved rating. Reading a property off a
 * client-module reference on the server is not allowed — React throws
 * "Attempted to call PERFORMANCE_RATING_LABELS() from the server but
 * PERFORMANCE_RATING_LABELS is on the client", 500-ing the page.
 *
 * The map is pure data with no dependency on React, so it belongs in a plain
 * module both sides can import. Keeping the definition here also means the
 * server-rendered label and the client-rendered stars cannot disagree about
 * which number means what.
 */
export const PERFORMANCE_RATING_LABELS: Record<number, string> = {
    1: "Average",
    2: "Good",
    3: "Very good",
    4: "Excellent",
    5: "Exceeds expectations",
};