"use client";

import { useState } from "react";
import { Download, Loader2, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";

const MONTHS = [
    { value: 1, label: "January" }, { value: 2, label: "February" },
    { value: 3, label: "March" },   { value: 4, label: "April" },
    { value: 5, label: "May" },     { value: 6, label: "June" },
    { value: 7, label: "July" },    { value: 8, label: "August" },
    { value: 9, label: "September" },{ value: 10, label: "October" },
    { value: 11, label: "November" },{ value: 12, label: "December" },
];

export function AttendanceDownloadButton() {
    const now = new Date();
    const [month, setMonth] = useState(now.getMonth() + 1);
    const [year, setYear] = useState(now.getFullYear());
    const [loading, setLoading] = useState(false);
    const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

    const handleDownload = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/attendance/download?month=${month}&year=${year}`);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                alert(err.error || "Download failed. Please try again.");
                return;
            }
            const blob = await res.blob();
            const contentDisposition = res.headers.get("content-disposition");
            let filename = `Attendance_${MONTHS.find(m => m.value === month)?.label}_${year}.csv`;
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
            alert("Download failed. Please check your connection.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md rounded-xl px-3 py-2 border border-white/20">
            <Calendar className="h-4 w-4 text-emerald-300 shrink-0" />
            <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="bg-transparent text-white text-xs font-semibold focus:outline-none appearance-none cursor-pointer"
            >
                {MONTHS.map((m) => (
                    <option key={m.value} value={m.value} className="text-slate-900">
                        {m.label}
                    </option>
                ))}
            </select>
            <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="bg-transparent text-white text-xs font-semibold focus:outline-none appearance-none cursor-pointer"
            >
                {years.map((y) => (
                    <option key={y} value={y} className="text-slate-900">{y}</option>
                ))}
            </select>
            <Button
                size="sm"
                onClick={handleDownload}
                disabled={loading}
                className="h-7 px-3 text-xs font-bold gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-white border-0 rounded-lg shadow-lg shadow-emerald-900/30 transition-all hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
            >
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                {loading ? "..." : "Download CSV"}
            </Button>
        </div>
    );
}
