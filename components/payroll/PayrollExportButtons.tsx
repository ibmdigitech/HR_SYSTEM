"use client";

import { useState } from "react";
import { FileSpreadsheet, FileText, Building2, Download, Loader2, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";

const MONTHS = [
    { value: 1, label: "January" },
    { value: 2, label: "February" },
    { value: 3, label: "March" },
    { value: 4, label: "April" },
    { value: 5, label: "May" },
    { value: 6, label: "June" },
    { value: 7, label: "July" },
    { value: 8, label: "August" },
    { value: 9, label: "September" },
    { value: 10, label: "October" },
    { value: 11, label: "November" },
    { value: 12, label: "December" },
];

export function PayrollExportButtons() {
    const now = new Date();
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [year, setYear] = useState(now.getFullYear());
    const [loading, setLoading] = useState<string | null>(null);

    const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

    const handleExport = async (format: "csv" | "excel" | "wps") => {
        setLoading(format);
        try {
            const res = await fetch(
                `/api/payroll/export?month=${month}&year=${year}&format=${format}`
            );

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                alert(errorData.error || "Export failed. Please try again.");
                return;
            }

            const blob = await res.blob();
            const contentDisposition = res.headers.get("content-disposition");
            let filename = `payroll_export.${format === "excel" ? "xlsx" : format === "wps" ? "sif" : "csv"}`;
            if (contentDisposition) {
                const match = contentDisposition.match(/filename="?(.+)"?/);
                if (match) filename = match[1];
            }

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch {
            alert("Export failed. Please check your connection and try again.");
        } finally {
            setLoading(null);
        }
    };

    const exportButtons = [
        {
            format: "csv" as const,
            label: "CSV",
            icon: FileText,
            gradient: "from-emerald-500 to-teal-600",
            hoverGradient: "hover:from-emerald-400 hover:to-teal-500",
            shadow: "shadow-emerald-500/25",
            description: "Spreadsheet format",
        },
        {
            format: "excel" as const,
            label: "Excel",
            icon: FileSpreadsheet,
            gradient: "from-blue-500 to-indigo-600",
            hoverGradient: "hover:from-blue-400 hover:to-indigo-500",
            shadow: "shadow-blue-500/25",
            description: "Microsoft Excel",
        },
        {
            format: "wps" as const,
            label: "WPS",
            icon: Building2,
            gradient: "from-violet-500 to-purple-600",
            hoverGradient: "hover:from-violet-400 hover:to-purple-500",
            shadow: "shadow-violet-500/25",
            description: "UAE MOL SIF",
        },
    ];

    return (
        <div className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border border-white/40 dark:border-slate-800/60 rounded-2xl p-5 shadow-sm">
            <div className="flex flex-col lg:flex-row items-start lg:items-center gap-4">
                {/* Label */}
                <div className="flex items-center gap-2 shrink-0">
                    <div className="p-2 bg-indigo-100 dark:bg-indigo-900/40 rounded-xl">
                        <Download className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-slate-800 dark:text-white">
                            Export Payroll
                        </h3>
                        <p className="text-xs text-slate-500">Select period & format</p>
                    </div>
                </div>

                {/* Selectors */}
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                        <select
                            value={month}
                            onChange={(e) => setMonth(Number(e.target.value))}
                            className="pl-9 pr-3 py-2 text-sm font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none cursor-pointer"
                        >
                            {MONTHS.map((m) => (
                                <option key={m.value} value={m.value}>
                                    {m.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    <select
                        value={year}
                        onChange={(e) => setYear(Number(e.target.value))}
                        className="px-3 py-2 text-sm font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none cursor-pointer"
                    >
                        {years.map((y) => (
                            <option key={y} value={y}>
                                {y}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Divider */}
                <div className="hidden lg:block w-px h-10 bg-slate-200 dark:bg-slate-700"></div>

                {/* Export Buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                    {exportButtons.map((btn) => {
                        const Icon = btn.icon;
                        const isLoading = loading === btn.format;
                        return (
                            <Button
                                key={btn.format}
                                onClick={() => handleExport(btn.format)}
                                disabled={loading !== null}
                                className={`
                                    relative gap-2 rounded-xl font-bold text-white border-0 
                                    bg-gradient-to-r ${btn.gradient} ${btn.hoverGradient}
                                    shadow-lg ${btn.shadow}
                                    transition-all duration-200 hover:scale-[1.02] hover:shadow-xl
                                    disabled:opacity-50 disabled:hover:scale-100
                                    px-4 py-2 text-sm
                                `}
                            >
                                {isLoading ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Icon className="h-4 w-4" />
                                )}
                                <span className="hidden sm:inline">{btn.label}</span>
                                <span className="hidden md:inline text-[10px] opacity-80 font-medium">
                                    {btn.description}
                                </span>
                            </Button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
