"use client";

import { useState } from "react";
import { generatePayroll } from "@/app/lib/actions/payroll";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function PayrollGeneratePage() {
    const [month, setMonth] = useState(new Date().getMonth() + 1);
    const [year, setYear] = useState(new Date().getFullYear());
    const [isGenerating, setIsGenerating] = useState(false);

    const handleGenerate = async () => {
        setIsGenerating(true);
        const toastId = toast.loading(`Generating payroll for ${month}/${year}...`);

        try {
            const result = await generatePayroll(month, year);
            if (result.success) {
                toast.success(result.message, { id: toastId });
            } else {
                toast.error(result.message, { id: toastId });
            }
        } catch (error: any) {
            toast.error("An unexpected error occurred", { id: toastId });
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className="p-8 space-y-6">
            {/* Back Button */}
            <Link href="/payroll" className="flex items-center gap-2 text-slate-500 hover:text-indigo-600 transition-colors w-fit">
                <ArrowLeft className="h-4 w-4" />
                <span className="text-sm font-medium">Back to Payroll</span>
            </Link>

            <div className="flex justify-between items-center bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Run Payroll</h1>
                    <p className="text-slate-500 dark:text-slate-400">Calculate and generate monthly salary disbursements.</p>
                </div>
                <div className="flex items-center gap-4">
                    <select
                        value={month}
                        onChange={(e) => setMonth(parseInt(e.target.value))}
                        className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                            <option key={m} value={m}>
                                {new Date(2000, m - 1).toLocaleString('default', { month: 'long' })}
                            </option>
                        ))}
                    </select>
                    <select
                        value={year}
                        onChange={(e) => setYear(parseInt(e.target.value))}
                        className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                    >
                        <option value="2024">2024</option>
                        <option value="2025">2025</option>
                        <option value="2026">2026</option>
                    </select>
                    <Button
                        size="lg"
                        className="bg-indigo-600 hover:bg-indigo-700 h-11 px-8 rounded-xl font-bold shadow-lg shadow-indigo-200 transition-all font-bold"
                        onClick={handleGenerate}
                        disabled={isGenerating}
                    >
                        {isGenerating ? "Processing..." : "Generate Monthly Payroll"}
                    </Button>
                </div>
            </div>

            <Card className="rounded-2xl border-none shadow-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white overflow-hidden">
                <CardContent className="p-10 flex flex-col items-center text-center space-y-4">
                    <div className="h-16 w-16 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm">
                        <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    <div className="space-y-2">
                        <h2 className="text-2xl font-black">Direct Database Processing</h2>
                        <p className="max-w-md text-indigo-50 text-sm opacity-90">
                            Payroll generation now works directly with employee salary structures in the database.
                            Click the button above to batch process all active employees for the selected period.
                        </p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
