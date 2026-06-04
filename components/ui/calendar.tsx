"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
    className,
    classNames,
    showOutsideDays = true,
    ...props
}: CalendarProps) {
    return (
        <DayPicker
            showOutsideDays={showOutsideDays}
            className={cn("p-3", className)}
            classNames={{
                months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
                month: "space-y-4",
                caption: "flex justify-center pt-2 relative items-center mb-2 px-1",
                caption_label: "text-xs font-black uppercase tracking-[0.2em] text-slate-800 dark:text-slate-200",
                nav: "space-x-1 flex items-center",
                nav_button: cn(
                    buttonVariants({ variant: "ghost" }),
                    "h-7 w-7 bg-transparent p-0 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors text-slate-600 dark:text-slate-400"
                ),
                nav_button_previous: "absolute left-1",
                nav_button_next: "absolute right-1",
                table: "w-full border-collapse space-y-1 block",
                head: "block w-full",
                tbody: "block w-full",
                head_row: "grid grid-cols-7 w-full border-b border-slate-100 dark:border-slate-800/50 pb-1 mb-1",
                head_cell:
                    "text-slate-400 rounded-md font-bold text-[9px] uppercase tracking-wider dark:text-slate-500 py-1.5 text-center flex items-center justify-center",
                row: "grid grid-cols-7 w-full mt-1.5",
                cell: "h-9 text-center text-sm p-0 relative [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-outside)]:bg-slate-50/50 [&:has([aria-selected])]:bg-slate-50 first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md focus-within:relative focus-within:z-20 dark:[&:has([aria-selected].day-outside)]:bg-slate-900/50 dark:[&:has([aria-selected])]:bg-slate-900 flex items-center justify-center",
                day: cn(
                    buttonVariants({ variant: "ghost" }),
                    "h-9 w-9 p-0 font-bold rounded-xl text-xs hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-all duration-200 aria-selected:opacity-100"
                ),
                day_range_end: "day-range-end",
                day_selected:
                    "bg-gradient-to-br from-violet-600 to-indigo-600 text-white font-black shadow-lg shadow-indigo-500/20 hover:from-violet-600 hover:to-indigo-600 hover:text-white focus:from-violet-600 focus:to-indigo-600 dark:from-violet-500 dark:to-indigo-500 dark:shadow-indigo-900/30",
                day_today: "border border-indigo-500/30 text-indigo-600 font-extrabold bg-indigo-50/30 dark:border-indigo-400/20 dark:text-indigo-400 dark:bg-indigo-950/10",
                day_outside:
                    "day-outside text-slate-350 opacity-40 aria-selected:bg-slate-50/50 aria-selected:text-slate-400 dark:text-slate-650 dark:aria-selected:bg-slate-900/50",
                day_disabled: "text-slate-300 opacity-20 dark:text-slate-700",
                day_range_middle:
                    "aria-selected:bg-slate-50 aria-selected:text-slate-900 dark:aria-selected:bg-slate-800 dark:aria-selected:text-slate-100",
                day_hidden: "invisible",
                ...classNames,
            }}
            components={{
                IconLeft: ({ ...props }) => <ChevronLeft className="h-4 w-4" />,
                IconRight: ({ ...props }) => <ChevronRight className="h-4 w-4" />,
            }}
            {...props}
        />
    )
}
Calendar.displayName = "Calendar"

export { Calendar }
