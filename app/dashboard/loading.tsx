import { PageSkeleton } from "@/components/common/Skeletons";

/**
 * Route-segment loading state (P0-24).
 *
 * Rendered while the page's server component awaits its data. Shows a skeleton
 * rather than a blank screen so slow queries no longer look like failures.
 */
export default function Loading() {
    return <PageSkeleton label="Loading dashboard" />;
}