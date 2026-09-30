import * as React from "react";
import { cn } from "@/lib/utils";

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
    value?: number;
    variant?: "linear" | "circular";
    size?: number;
    strokeWidth?: number;
    showValue?: boolean;
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
    ({ className, value = 0, variant = "linear", size = 64, strokeWidth = 4, showValue = true, ...props }, ref) => {
        const clampedValue = Math.min(100, Math.max(0, value));

        if (variant === "circular") {
            const radius = (size - strokeWidth) / 2;
            const circumference = 2 * Math.PI * radius;
            const offset = circumference - (clampedValue / 100) * circumference;

            return (
                <div
                    ref={ref}
                    className={cn("relative inline-flex items-center justify-center", className)}
                    style={{ width: size, height: size }}
                    {...props}
                    role="progressbar"
                    aria-valuenow={clampedValue}
                    aria-valuemin={0}
                    aria-valuemax={100}
                >
                    <svg width={size} height={size} className="transform -rotate-90">
                        <circle
                            className="text-slate-200 dark:text-slate-700"
                            strokeWidth={strokeWidth}
                            stroke="currentColor"
                            fill="transparent"
                            r={radius}
                            cx={size / 2}
                            cy={size / 2}
                        />
                        <circle
                            className="text-indigo-600 dark:text-indigo-500 transition-all duration-500"
                            strokeWidth={strokeWidth}
                            strokeDasharray={circumference}
                            strokeDashoffset={offset}
                            strokeLinecap="round"
                            stroke="currentColor"
                            fill="transparent"
                            r={radius}
                            cx={size / 2}
                            cy={size / 2}
                        />
                    </svg>
                    {showValue && (
                        <span className="absolute text-center">
                            <span className="text-lg font-black text-slate-800 dark:text-slate-200">{clampedValue}%</span>
                        </span>
                    )}
                </div>
            );
        }

        return (
            <div
                ref={ref}
                className={cn(
                    "relative h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800",
                    className
                )}
                {...props}
                role="progressbar"
                aria-valuenow={clampedValue}
                aria-valuemin={0}
                aria-valuemax={100}
            >
                <div
                    className="h-full bg-indigo-600 dark:bg-indigo-500 transition-all duration-300"
                    style={{ width: `${clampedValue}%` }}
                />
            </div>
        );
    }
);
Progress.displayName = "Progress";

export { Progress };