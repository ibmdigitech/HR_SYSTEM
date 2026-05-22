"use client";

import { useState, useEffect } from "react";
import { getEmployeesForLetter, saveLetterRecord } from "@/app/lib/actions/letters";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Download, Mail, Loader2, CheckCircle2, Building2 } from "lucide-react";
import Link from "next/link";
import jsPDF from "jspdf";

const COMPANY_NAME = "IBMDIGITECH LLC";
const COMPANY_ADDRESS = "Dubai, United Arab Emirates";

export default function OfferLetterPage() {
    const [employees, setEmployees] = useState<any[]>([]);
    const [selectedEmpId, setSelectedEmpId] = useState("");
    const [loading, setLoading] = useState(false);
    const [saved, setSaved] = useState(false);
    const [form, setForm] = useState({
        recipientName: "", designation: "", department: "",
        joiningDate: "", salary: "", probationDays: "90",
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
                salary: emp.salaryStructure?.ctc ? emp.salaryStructure.ctc.toString() : "",
            }));
        }
    };

    const handleGenerate = async () => {
        setLoading(true);
        const doc = new jsPDF();

        // Header bar
        doc.setFillColor(79, 70, 229);
        doc.rect(0, 0, 210, 28, "F");
        doc.setFontSize(18); doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.text(COMPANY_NAME, 105, 12, { align: "center" });
        doc.setFontSize(9); doc.setFont("helvetica", "normal");
        doc.text(COMPANY_ADDRESS, 105, 20, { align: "center" });

        // Title
        doc.setFontSize(16); doc.setTextColor(79, 70, 229);
        doc.setFont("helvetica", "bold");
        doc.text("OFFER LETTER", 105, 42, { align: "center" });
        doc.setDrawColor(226, 232, 240); doc.line(20, 47, 190, 47);

        doc.setFontSize(10); doc.setTextColor(100, 116, 139);
        doc.setFont("helvetica", "normal");
        doc.text(`Date: ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`, 20, 56);

        doc.setTextColor(15, 23, 42);
        doc.text(`To,`, 20, 68);
        doc.setFontSize(12); doc.setFont("helvetica", "bold");
        doc.text(form.recipientName || "[Candidate Name]", 20, 76);
        doc.setFont("helvetica", "normal"); doc.setFontSize(10);

        const body =
            `Dear ${form.recipientName || "Candidate"},\n\n` +
            `We are pleased to offer you the position of ${form.designation || "[Designation]"} in the ` +
            `${form.department || "[Department]"} department at ${COMPANY_NAME}.\n\n` +
            `After careful consideration of your qualifications and experience, we believe you will be a ` +
            `valuable addition to our team. Details of your employment offer are as follows:\n\n` +
            `  Position       : ${form.designation || "[Designation]"}\n` +
            `  Department     : ${form.department || "[Department]"}\n` +
            `  Joining Date   : ${form.joiningDate ? new Date(form.joiningDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "[Joining Date]"}\n` +
            `  Annual CTC     : AED ${form.salary ? parseFloat(form.salary).toLocaleString() : "[Salary]"}\n` +
            `  Probation      : ${form.probationDays} days\n\n` +
            `This offer is subject to satisfactory completion of pre-employment checks. ` +
            `Please confirm acceptance by signing and returning a copy of this letter before your joining date.\n\n` +
            `We look forward to welcoming you to the ${COMPANY_NAME} family.`;

        const lines = doc.splitTextToSize(body, 170);
        doc.text(lines, 20, 92);

        doc.text("Yours sincerely,", 20, 218);
        doc.setFont("helvetica", "bold");
        doc.text("Director of Human Resources", 20, 228);
        doc.setFont("helvetica", "normal"); doc.setTextColor(100, 116, 139);
        doc.text(COMPANY_NAME, 20, 235);

        doc.setFillColor(248, 250, 252); doc.rect(0, 272, 210, 25, "F");
        doc.setFontSize(7); doc.setTextColor(148, 163, 184);
        doc.text("This is a computer-generated document and does not require a physical signature.", 105, 282, { align: "center" });

        doc.save(`Offer_Letter_${(form.recipientName || "candidate").replace(/\s+/g, "_")}.pdf`);

        const fd = new FormData();
        fd.append("type", "OFFER");
        fd.append("recipientName", form.recipientName || "Unknown");
        fd.append("employeeId", selectedEmpId);
        fd.append("details", `Designation: ${form.designation}, Salary: AED ${form.salary}`);
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
                    <div className="h-10 w-10 rounded-xl bg-indigo-600 flex items-center justify-center">
                        <Mail className="h-5 w-5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Offer Letter</h1>
                        <p className="text-slate-500">Generate and download a professional offer letter.</p>
                    </div>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card className="border-slate-200 dark:border-slate-800">
                    <CardHeader>
                        <CardTitle>Letter Details</CardTitle>
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
                            <Label>Candidate Name *</Label>
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
                                <Label>Joining Date</Label>
                                <Input type="date" value={form.joiningDate}
                                    onChange={e => setForm({ ...form, joiningDate: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                                <Label>Probation (days)</Label>
                                <Input type="number" value={form.probationDays}
                                    onChange={e => setForm({ ...form, probationDays: e.target.value })} />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Annual CTC (AED)</Label>
                            <Input type="number" placeholder="e.g. 120000" value={form.salary}
                                onChange={e => setForm({ ...form, salary: e.target.value })} />
                        </div>
                        <Button
                            className="w-full gap-2 bg-indigo-600 hover:bg-indigo-700 h-11 font-bold shadow-lg shadow-indigo-200 dark:shadow-none"
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
                            <div className="h-8 rounded bg-indigo-600 flex items-center justify-center">
                                <Building2 className="h-4 w-4 text-white" />
                            </div>
                            <div className="text-center">
                                <div className="text-[8px] font-bold text-indigo-600 uppercase tracking-wide">Offer Letter</div>
                            </div>
                            <div className="space-y-1.5">
                                {[1, 0.7, 0.9, 0.6, 0.8, 0.75, 0.9, 0.65].map((w, i) => (
                                    <div key={i} className="h-1.5 rounded bg-slate-200 dark:bg-slate-700" style={{ width: `${w * 100}%` }} />
                                ))}
                            </div>
                        </div>
                        <div className="text-sm font-medium text-slate-500">
                            {form.recipientName ? (
                                <span>Ready for <span className="text-indigo-600 font-bold">{form.recipientName}</span></span>
                            ) : "Fill in details to generate PDF"}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
