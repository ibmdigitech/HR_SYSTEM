"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import {
    ArrowLeft, Upload, FileText, CheckCircle2, XCircle, AlertTriangle,
    Download, Cpu, RefreshCw, ChevronRight, Info, TableIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { importAttendanceFromCsv, parseCsvContent, type ParsedPunchRecord, type ImportResult } from "@/app/lib/actions/attendance-import";

const TEMPLATE_CSV = `EmployeeCode,Date,Time,PunchType
EMP-001,2026-06-01,08:55,IN
EMP-001,2026-06-01,18:05,OUT
EMP-002,2026-06-01,09:30,IN
EMP-002,2026-06-01,17:45,OUT
EMP-003,2026-06-01,08:00,IN
EMP-003,2026-06-01,16:00,OUT`;

export default function MachineIntegrationPage() {
    const [isDragging, setIsDragging] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [parsedRecords, setParsedRecords] = useState<ParsedPunchRecord[]>([]);
    const [parseErrors, setParseErrors] = useState<{ row: number; message: string }[]>([]);
    const [importResult, setImportResult] = useState<ImportResult | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [isParsing, setIsParsing] = useState(false);
    const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFile = useCallback(async (f: File) => {
        if (!f.name.endsWith(".csv") && !f.name.endsWith(".txt")) {
            alert("Please upload a CSV or TXT file.");
            return;
        }
        setFile(f);
        setIsParsing(true);
        setParsedRecords([]);
        setParseErrors([]);
        setImportResult(null);

        const content = await f.text();
        const result = await parseCsvContent(content);
        setParsedRecords(result.records);
        setParseErrors(result.errors);
        setStep("preview");
        setIsParsing(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const droppedFile = e.dataTransfer.files[0];
        if (droppedFile) handleFile(droppedFile);
    }, [handleFile]);

    const handleImport = async () => {
        if (!file) return;
        setIsImporting(true);
        const formData = new FormData();
        formData.append("file", file);
        const result = await importAttendanceFromCsv(formData);
        setImportResult(result);
        setStep("done");
        setIsImporting(false);
    };

    const handleReset = () => {
        setFile(null);
        setParsedRecords([]);
        setParseErrors([]);
        setImportResult(null);
        setStep("upload");
    };

    const downloadTemplate = () => {
        const blob = new Blob([TEMPLATE_CSV], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "attendance_import_template.csv";
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
    };

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-7xl mx-auto">
            {/* Back Button */}
            <Link href="/attendance" className="flex items-center gap-2 text-slate-500 hover:text-emerald-600 transition-colors w-fit group">
                <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
                <span className="text-sm font-semibold">Back to Attendance</span>
            </Link>

            {/* Header */}
            <div className="relative bg-gradient-to-r from-slate-900 via-emerald-950 to-teal-950 p-8 rounded-[2rem] shadow-2xl overflow-hidden">
                <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
                <div className="absolute bottom-0 left-0 w-72 h-72 bg-teal-500/10 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4" />
                <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2.5 bg-emerald-500/20 rounded-xl backdrop-blur-sm">
                                <Cpu className="h-6 w-6 text-emerald-400" />
                            </div>
                            <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white">Machine Integration</h1>
                        </div>
                        <p className="text-emerald-200/80 text-sm font-medium max-w-xl">
                            Import attendance punch data directly from biometric & RFID machines (ZADCO, ZKTeco, etc.)
                            by uploading the exported CSV file.
                        </p>
                    </div>
                    <Button
                        onClick={downloadTemplate}
                        variant="secondary"
                        className="gap-2 rounded-xl font-bold bg-white/10 text-white hover:bg-white/20 border-0 backdrop-blur-md shrink-0"
                    >
                        <Download className="h-4 w-4" />
                        Download Template
                    </Button>
                </div>

                {/* Step Indicator */}
                <div className="relative z-10 flex items-center gap-2 mt-6">
                    {["Upload File", "Review & Verify", "Import Complete"].map((label, i) => {
                        const stepMap = { 0: "upload", 1: "preview", 2: "done" };
                        const current = ["upload", "preview", "done"].indexOf(step);
                        const isActive = i === current;
                        const isDone = i < current;
                        return (
                            <div key={label} className="flex items-center gap-2">
                                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                                    isActive ? "bg-emerald-500 text-white" :
                                    isDone ? "bg-white/20 text-white" :
                                    "bg-white/10 text-white/40"
                                }`}>
                                    <span className={`h-4 w-4 rounded-full flex items-center justify-center text-[10px] font-black ${
                                        isDone ? "bg-white/30" : isActive ? "bg-white/30" : "bg-white/10"
                                    }`}>{isDone ? "✓" : i + 1}</span>
                                    {label}
                                </div>
                                {i < 2 && <ChevronRight className="h-3 w-3 text-white/30" />}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Format Info */}
            <Card className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800/50 rounded-2xl">
                <CardContent className="p-5 flex items-start gap-4">
                    <Info className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
                    <div>
                        <h4 className="font-bold text-blue-800 dark:text-blue-300 text-sm mb-1">Supported CSV Format (ZADCO / ZKTeco)</h4>
                        <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                            Required columns: <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">EmployeeCode</code>,{" "}
                            <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">Date</code> (YYYY-MM-DD or DD/MM/YYYY),{" "}
                            <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">Time</code> (HH:MM or HH:MM:SS),{" "}
                            <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">PunchType</code> (IN or OUT).
                            Each employee row must match an existing Employee Code or Roll Number in the system.
                        </p>
                    </div>
                </CardContent>
            </Card>

            {/* STEP 1: Upload */}
            {step === "upload" && (
                <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
                    <CardHeader className="bg-slate-50 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-800 px-6 py-5">
                        <CardTitle className="text-lg font-bold flex items-center gap-2">
                            <Upload className="h-5 w-5 text-emerald-600" /> Upload Punch Data File
                        </CardTitle>
                        <CardDescription>Drag & drop your CSV file or click to browse</CardDescription>
                    </CardHeader>
                    <CardContent className="p-8">
                        <div
                            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                            onDragLeave={() => setIsDragging(false)}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                            className={`relative border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer transition-all duration-300 ${
                                isDragging
                                    ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 scale-[1.01]"
                                    : "border-slate-200 dark:border-slate-700 hover:border-emerald-300 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/10"
                            }`}
                        >
                            {isParsing ? (
                                <div className="flex flex-col items-center gap-4">
                                    <div className="h-14 w-14 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                                        <RefreshCw className="h-7 w-7 text-emerald-600 animate-spin" />
                                    </div>
                                    <p className="text-slate-600 dark:text-slate-400 font-semibold">Parsing file...</p>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-4">
                                    <div className={`h-16 w-16 rounded-2xl flex items-center justify-center transition-colors ${
                                        isDragging ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-slate-100 dark:bg-slate-800"
                                    }`}>
                                        <Upload className={`h-8 w-8 ${isDragging ? "text-emerald-600" : "text-slate-400"}`} />
                                    </div>
                                    <div>
                                        <p className="font-bold text-slate-700 dark:text-slate-200 text-lg mb-1">
                                            {isDragging ? "Drop to upload" : "Drop your CSV file here"}
                                        </p>
                                        <p className="text-slate-500 dark:text-slate-400 text-sm">
                                            or <span className="text-emerald-600 font-bold underline underline-offset-2">click to browse</span> — CSV, TXT supported
                                        </p>
                                    </div>
                                </div>
                            )}
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".csv,.txt"
                                className="hidden"
                                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                            />
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* STEP 2: Preview */}
            {step === "preview" && (
                <div className="space-y-6">
                    {/* Summary Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800 rounded-2xl shadow-sm">
                            <CardContent className="p-5">
                                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Total Rows</div>
                                <div className="text-3xl font-black text-slate-800 dark:text-white">{parsedRecords.length + parseErrors.length}</div>
                            </CardContent>
                        </Card>
                        <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800 rounded-2xl shadow-sm">
                            <CardContent className="p-5">
                                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Valid Records</div>
                                <div className="text-3xl font-black text-emerald-600">{parsedRecords.length}</div>
                            </CardContent>
                        </Card>
                        <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800 rounded-2xl shadow-sm">
                            <CardContent className="p-5">
                                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Parse Errors</div>
                                <div className="text-3xl font-black text-rose-600">{parseErrors.length}</div>
                            </CardContent>
                        </Card>
                        <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800 rounded-2xl shadow-sm">
                            <CardContent className="p-5">
                                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">File</div>
                                <div className="text-sm font-bold text-slate-700 dark:text-slate-300 truncate">{file?.name}</div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Parse Errors */}
                    {parseErrors.length > 0 && (
                        <Card className="bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800/50 rounded-2xl">
                            <CardHeader className="px-6 py-4">
                                <CardTitle className="text-base font-bold text-rose-700 dark:text-rose-400 flex items-center gap-2">
                                    <AlertTriangle className="h-4 w-4" /> Parse Errors ({parseErrors.length} rows skipped)
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="px-6 pb-5 space-y-2 max-h-40 overflow-y-auto">
                                {parseErrors.slice(0, 10).map((err, i) => (
                                    <div key={i} className="text-xs text-rose-600 dark:text-rose-400 font-medium flex gap-2">
                                        <span className="font-bold shrink-0">Row {err.row}:</span>
                                        <span>{err.message}</span>
                                    </div>
                                ))}
                                {parseErrors.length > 10 && (
                                    <p className="text-xs text-rose-500 font-semibold">...and {parseErrors.length - 10} more errors</p>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* Preview Table */}
                    {parsedRecords.length > 0 && (
                        <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden">
                            <CardHeader className="bg-slate-50 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-800 px-6 py-5">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-lg font-bold flex items-center gap-2">
                                        <TableIcon className="h-5 w-5 text-emerald-600" />
                                        Preview (first 20 records)
                                    </CardTitle>
                                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 font-bold">
                                        {parsedRecords.length} valid records
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0 overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20">
                                            <th className="text-left px-5 py-3 font-bold text-slate-500 text-xs uppercase tracking-wider">Row</th>
                                            <th className="text-left px-5 py-3 font-bold text-slate-500 text-xs uppercase tracking-wider">Employee Code</th>
                                            <th className="text-left px-5 py-3 font-bold text-slate-500 text-xs uppercase tracking-wider">Date</th>
                                            <th className="text-left px-5 py-3 font-bold text-slate-500 text-xs uppercase tracking-wider">Time</th>
                                            <th className="text-left px-5 py-3 font-bold text-slate-500 text-xs uppercase tracking-wider">Type</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {parsedRecords.slice(0, 20).map((record) => (
                                            <tr key={record.rowNumber} className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50/80 dark:hover:bg-slate-900/40">
                                                <td className="px-5 py-3 text-slate-400 font-medium">{record.rowNumber}</td>
                                                <td className="px-5 py-3 font-bold text-slate-800 dark:text-slate-200">{record.employeeCode}</td>
                                                <td className="px-5 py-3 text-slate-600 dark:text-slate-400 font-medium">{record.date}</td>
                                                <td className="px-5 py-3 text-slate-600 dark:text-slate-400 font-medium">{record.time}</td>
                                                <td className="px-5 py-3">
                                                    <Badge className={`font-bold border-0 ${
                                                        record.punchType === "IN"
                                                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                                            : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                                    }`}>
                                                        {record.punchType}
                                                    </Badge>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </CardContent>
                        </Card>
                    )}

                    {/* Action Buttons */}
                    <div className="flex flex-col sm:flex-row gap-3 justify-end">
                        <Button variant="outline" onClick={handleReset} className="rounded-xl font-bold gap-2 border-slate-200">
                            <RefreshCw className="h-4 w-4" /> Upload Different File
                        </Button>
                        <Button
                            onClick={handleImport}
                            disabled={isImporting || parsedRecords.length === 0}
                            className="rounded-xl font-bold gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-200 dark:shadow-emerald-900/30 px-8"
                        >
                            {isImporting ? (
                                <><RefreshCw className="h-4 w-4 animate-spin" /> Importing...</>
                            ) : (
                                <><Upload className="h-4 w-4" /> Import {parsedRecords.length} Records</>
                            )}
                        </Button>
                    </div>
                </div>
            )}

            {/* STEP 3: Done */}
            {step === "done" && importResult && (
                <div className="space-y-6">
                    {/* Result Banner */}
                    <Card className={`rounded-2xl border-0 shadow-lg overflow-hidden ${
                        importResult.success ? "bg-gradient-to-br from-emerald-500 to-teal-600" : "bg-gradient-to-br from-rose-500 to-red-600"
                    }`}>
                        <CardContent className="p-8 flex items-center gap-6">
                            <div className="h-16 w-16 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                                {importResult.success ? (
                                    <CheckCircle2 className="h-9 w-9 text-white" />
                                ) : (
                                    <XCircle className="h-9 w-9 text-white" />
                                )}
                            </div>
                            <div className="text-white">
                                <h2 className="text-2xl font-black mb-1">
                                    {importResult.success ? "Import Successful!" : "Import Failed"}
                                </h2>
                                <p className="opacity-80 text-sm font-medium">
                                    {importResult.success
                                        ? `Successfully processed ${importResult.imported} attendance records.`
                                        : importResult.errors[0]?.message || "An error occurred during import."}
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Result Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {[
                            { label: "Total Parsed", value: importResult.totalRows, color: "text-slate-800 dark:text-white" },
                            { label: "Imported", value: importResult.imported, color: "text-emerald-600" },
                            { label: "Duplicates", value: importResult.duplicates, color: "text-amber-600" },
                            { label: "Skipped", value: importResult.skipped, color: "text-rose-600" },
                        ].map((stat) => (
                            <Card key={stat.label} className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800 rounded-2xl shadow-sm">
                                <CardContent className="p-5">
                                    <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">{stat.label}</div>
                                    <div className={`text-3xl font-black ${stat.color}`}>{stat.value}</div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    {/* Errors */}
                    {importResult.errors.length > 0 && (
                        <Card className="bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800/50 rounded-2xl">
                            <CardHeader className="px-6 py-4">
                                <CardTitle className="text-base font-bold text-rose-700 dark:text-rose-400 flex items-center gap-2">
                                    <AlertTriangle className="h-4 w-4" /> Errors / Warnings
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="px-6 pb-5 space-y-2 max-h-48 overflow-y-auto">
                                {importResult.errors.slice(0, 15).map((err, i) => (
                                    <div key={i} className="text-xs text-rose-600 dark:text-rose-400 font-medium flex gap-2">
                                        <span className="font-bold shrink-0">Row {err.row}:</span>
                                        <span>{err.message}</span>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    )}

                    <div className="flex flex-col sm:flex-row gap-3 justify-end">
                        <Button variant="outline" onClick={handleReset} className="rounded-xl font-bold gap-2 border-slate-200">
                            <Upload className="h-4 w-4" /> Import Another File
                        </Button>
                        <Link href="/attendance">
                            <Button className="rounded-xl font-bold gap-2 bg-emerald-600 hover:bg-emerald-700 text-white w-full sm:w-auto">
                                <FileText className="h-4 w-4" /> View Attendance Records
                            </Button>
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
}
