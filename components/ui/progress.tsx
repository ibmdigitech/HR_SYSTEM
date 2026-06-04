import * as React from "react";
import { cn } from "@/lib/utils";

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
    value?: number;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
    ({ className, value = 0, ...props }, ref) => {
        return (
            <div
                ref={ref}
                className={cn(
                    "relative h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800",
                    className
                )}
                {...props}
            >
                <div
                    className="h-full bg-indigo-600 dark:bg-indigo-500 transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
                />
            </div>
        );
    }
);
Progress.displayName = "Progress";

export { Progress };
