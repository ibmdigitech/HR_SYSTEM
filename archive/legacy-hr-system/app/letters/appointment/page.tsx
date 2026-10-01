"use client";

import { useState, useEffect } from "react";
import { getEmployeesForLetter, saveLetterRecord } from "@/app/lib/actions/letters";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Download, Briefcase, Loader2, CheckCircle2, Building2 } from "lucide-react";
import Link from "next/link";
import jsPDF from "jspdf";

const COMPANY_NAME = "IBMDIGITECH LLC";
const COMPANY_ADDRESS = "Dubai, United Arab Emirates";

export default function AppointmentLetterPage() {
    const [employees, setEmployees] = useState<any[]>([]);
    const [selectedEmpId, setSelectedEmpId] = useState("");
    const [loading, setLoading] = useState(false);
    const [saved, setSaved] = useState(false);
    const [form, setForm] = useState({
        recipientName: "", designation: "", department: "",
        joiningDate: "", reportingManager: "", workLocation: "",
    });

    useEffect(() => {
        getEmployeesForLetter().then(res => { if (res.success) setEmployees(res.data as any[]); });
    }, []);

    const handleEmployeeSelect = (empId: string) => {
        setSelectedEmpId(empId);
        const emp = employees.find((e: any) => e.id === empId);
        if (emp) {
            setForm(prev => ({
                ...prev,
                recipientName: `${emp.firstName} ${emp.lastName}`,
                designation: emp.designation,
                department: emp.department,
                joiningDate: emp.joiningDate ? new Date(emp.joiningDate).toISOString().split("T")[0] : "",
            }));
        }
    };

    const handleGenerate = async () => {
        setLoading(true);
        const doc = new jsPDF();

        // Header bar
        doc.setFillColor(16, 185, 129);
        doc.rect(0, 0, 210, 28, "F");
        doc.setFontSize(18); doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.text(COMPANY_NAME, 105, 12, { align: "center" });
        doc.setFontSize(9); doc.setFont("helvetica", "normal");
        doc.text(COMPANY_ADDRESS, 105, 20, { align: "center" });

        // Title
        doc.setFontSize(16); doc.setTextColor(16, 185, 129);
        doc.setFont("helvetica", "bold");
        doc.text("APPOINTMENT LETTER", 105, 42, { align: "center" });
        doc.setDrawColor(226, 232, 240); doc.line(20, 47, 190, 47);

        doc.setFontSize(10); doc.setTextColor(100, 116, 139);
        doc.setFont("helvetica", "normal");
        doc.text(`Date: ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`, 20, 56);

        doc.setTextColor(15, 23, 42);
        doc.text(`To,`, 20, 68);
        doc.setFontSize(12); doc.setFont("helvetica", "bold");
        doc.text(form.recipientName || "[Employee Name]", 20, 76);
        doc.setFont("helvetica", "normal"); doc.setFontSize(10);

        const joiningDateFormatted = form.joiningDate
            ? new Date(form.joiningDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
            : "[Joining Date]";

        const body =
            `Dear ${form.recipientName || "Employee"},\n\n` +
            `Further to your acceptance of our offer of employment, we are pleased to formally appoint you ` +
            `as ${form.designation || "[Designation]"} in the ${form.department || "[Department]"} department ` +
            `at ${COMPANY_NAME}, effective from ${joiningDateFormatted}.\n\n` +
            `Your appointment is subject to the following terms and conditions:\n\n` +
            `  Position       : ${form.designation || "[Designation]"}\n` +
            `  Department     : ${form.department || "[Department]"}\n` +
            `  Date of Joining: ${joiningDateFormatted}\n` +
            `  Work Location  : ${form.workLocation || "Dubai, UAE"}\n` +
            (form.reportingManager ? `  Reports To     : ${form.reportingManager}\n` : "") +
            `  Probation      : 90 days from date of joining\n\n` +
            `You will abide by the company's policies, rules, and regulations as amended from time to time. ` +
            `This appointment is on a permanent basis subject to satisfactory performance during probation.\n\n` +
            `We welcome you to ${COMPANY_NAME} and look forward to your valuable contributions.`;

        const lines = doc.splitTextToSize(body, 170);
        doc.text(lines, 20, 92);

        doc.text("Yours sincerely,", 20, 222);
        doc.setFont("helvetica", "bold");
        doc.text("Director of Human Resources", 20, 232);
        doc.setFont("helvetica", "normal"); doc.setTextColor(100, 116, 139);
        doc.text(COMPANY_NAME, 20, 239);

        doc.setFillColor(248, 250, 252); doc.rect(0, 272, 210, 25, "F");
        doc.setFontSize(7); doc.setTextColor(148, 163, 184);
        doc.text("This is a computer-generated document and does not require a physical signature.", 105, 282, { align: "center" });

        doc.save(`Appointment_Letter_${(form.recipientName || "employee").replace(/\s+/g, "_")}.pdf`);

        const fd = new FormData();
        fd.append("type", "APPOINTMENT");
        fd.append("recipientName", form.recipientName || "Unknown");
        fd.append("employeeId", selectedEmpId);
        fd.append("details", `Designation: ${form.designation}, Dept: ${form.department}`);
        await saveLetterRecord(fd);

        setLoading(false); setSaved(true);
        setTimeout(() => setSaved(false), 4000);
    };

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            <div>
                <Link href="/letters" className="text-sm text-muted-foreground hover:text-primary flex items-center gap-2 mb-4">
                    <ArrowLeft className="h-4 w-4" /> Back to Letters
                </Link>
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-emerald-600 flex items-center justify-center">
                        <Briefcase className="h-5 w-5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Appointment Letter</h1>
                        <p className="text-slate-500">Formally confirm employment for new hires.</p>
                    </div>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card className="border-slate-200 dark:border-slate-800">
                    <CardHeader>
                        <CardTitle>Employee Details</CardTitle>
                        <CardDescription>Select an employee or fill in manually.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label>Auto-fill from Employee</Label>
                            <Select value={selectedEmpId} onValueChange={handleEmployeeSelect}>
                                <SelectTrigger><SelectValue placeholder="Select employee..." /></SelectTrigger>
                                <SelectContent>
                                    {employees.map((emp: any) => (
                                        <SelectItem key={emp.id} value={emp.id}>
                                            {emp.firstName} {emp.lastName} — {emp.designation}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="h-px bg-slate-100 dark:bg-slate-800" />
                        <div className="space-y-2">
                            <Label>Employee Name *</Label>
                            <Input placeholder="Full name" value={form.recipientName}
                                onChange={e => setForm({ ...form, recipientName: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Designation *</Label>
                            <Input placeholder="e.g. Software Engineer" value={form.designation}
                                onChange={e => setForm({ ...form, designation: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label>Department</Label>
                            <Input placeholder="e.g. Technology" value={form.department}
                                onChange={e => setForm({ ...form, department: e.target.value })} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label>Date of Joining</Label>
                                <Input type="date" value={form.joiningDate}
                                    onChange={e => setForm({ ...form, joiningDate: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                                <Label>Work Location</Label>
                                <Input placeholder="e.g. Dubai, UAE" value={form.workLocation}
                                    onChange={e => setForm({ ...form, workLocation: e.target.value })} />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Reporting Manager (optional)</Label>
                            <Input placeholder="Manager name" value={form.reportingManager}
                                onChange={e => setForm({ ...form, reportingManager: e.target.value })} />
                        </div>
                        <Button
                            className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 h-11 font-bold shadow-lg shadow-emerald-200 dark:shadow-none"
                            onClick={handleGenerate}
                            disabled={loading || !form.recipientName}
                        >
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> :
                                saved ? <CheckCircle2 className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                            {loading ? "Generating..." : saved ? "Saved & Downloaded!" : "Generate & Download PDF"}
                        </Button>
                    </CardContent>
                </Card>

                <Card className="border-dashed border-2 border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex flex-col">
                    <CardHeader>
                        <CardTitle className="text-sm text-slate-500 font-semibold uppercase tracking-wider">Document Preview</CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 flex flex-col items-center justify-center text-center space-y-6 py-8">
                        <div className="w-full max-w-[200px] space-y-3 bg-white dark:bg-slate-900 rounded-lg shadow p-4 border border-slate-100 dark:border-slate-800">
                            <div className="h-8 rounded bg-emerald-600 flex items-center justify-center">
                                <Building2 className="h-4 w-4 text-white" />
                            </div>
                            <div className="text-center">
                                <div className="text-[8px] font-bold text-emerald-600 uppercase tracking-wide">Appointment Letter</div>
                            </div>
                            <div className="space-y-1.5">
                                {[1, 0.7, 0.9, 0.6, 0.8, 0.75, 0.9, 0.65].map((w, i) => (
                                    <div key={i} className="h-1.5 rounded bg-slate-200 dark:bg-slate-700" style={{ width: `${w * 100}%` }} />
                                ))}
                            </div>
                        </div>
                        <div className="text-sm font-medium text-slate-500">
                            {form.recipientName ? (
                                <span>Ready for <span className="text-emerald-600 font-bold">{form.recipientName}</span></span>
                            ) : "Select an employee to generate"}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
