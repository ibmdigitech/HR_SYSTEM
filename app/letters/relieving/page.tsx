"use client";

import { useState, useEffect } from "react";
import { getEmployeesForLetter, saveLetterRecord } from "@/app/lib/actions/letters";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Download, UserMinus, Loader2, CheckCircle2, Building2 } from "lucide-react";
import Link from "next/link";
import jsPDF from "jspdf";

import { getCompanySettings, CompanySettings } from "@/app/lib/actions/company-settings";

export default function RelievingLetterPage() {
    const [employees, setEmployees] = useState<any[]>([]);
    const [selectedEmpId, setSelectedEmpId] = useState("");
    const [loading, setLoading] = useState(false);
    const [saved, setSaved] = useState(false);
    const [form, setForm] = useState({
        recipientName: "", designation: "", department: "",
        joiningDate: "", resignationDate: "", lastWorkingDay: "",
        reason: "resignation", remarks: "",
    });
    const [companySettings, setCompanySettings] = useState<CompanySettings>({
        name: "IBMDigiTech LLC",
        logo: "",
        address: "Dubai, UAE",
        phone: "+971 4 123 4567",
        email: "hr@ibmdigitech.com",
        website: "https://ibmdigitech.com",
        signature: "",
        letterhead: "",
    });

    useEffect(() => {
        getEmployeesForLetter().then(res => { if (res.success) setEmployees(res.data as any[]); });
        getCompanySettings().then(settings => setCompanySettings(settings));
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
        doc.setFillColor(239, 68, 68);
        doc.rect(0, 0, 210, 28, "F");
        doc.setFontSize(18); doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.text(companySettings.name, 105, 12, { align: "center" });
        doc.setFontSize(9); doc.setFont("helvetica", "normal");
        doc.text(companySettings.address, 105, 20, { align: "center" });

        // Add logo if exists
        if (companySettings.logo) {
            try {
                doc.addImage(companySettings.logo, "PNG", 15, 4, 20, 20);
            } catch (e) {
                console.error("Failed to add logo to PDF:", e);
            }
        }

        // Title
        doc.setFontSize(16); doc.setTextColor(239, 68, 68);
        doc.setFont("helvetica", "bold");
        doc.text("RELIEVING LETTER", 105, 42, { align: "center" });
        doc.setDrawColor(226, 232, 240); doc.line(20, 47, 190, 47);

        doc.setFontSize(10); doc.setTextColor(100, 116, 139);
        doc.setFont("helvetica", "normal");
        doc.text(`Date: ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`, 20, 56);
        doc.text("To Whom It May Concern,", 20, 68);

        doc.setFontSize(12); doc.setFont("helvetica", "bold");
        doc.setTextColor(15, 23, 42);
        doc.text(form.recipientName || "[Employee Name]", 20, 80);
        doc.setFont("helvetica", "normal"); doc.setFontSize(10);

        const joinFormatted = form.joiningDate
            ? new Date(form.joiningDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
            : "[Joining Date]";
        const lastDayFormatted = form.lastWorkingDay
            ? new Date(form.lastWorkingDay).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
            : "[Last Working Day]";
        const resignFormatted = form.resignationDate
            ? new Date(form.resignationDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
            : "[Resignation Date]";

        const body =
            `This is to certify that ${form.recipientName || "[Employee Name]"} was employed with ${companySettings.name} ` +
            `as ${form.designation || "[Designation]"} in the ${form.department || "[Department]"} department ` +
            `from ${joinFormatted} to ${lastDayFormatted}.\n\n` +
            `${form.reason === "resignation"
                ? `Based on ${form.recipientName?.split(" ")[0] || "their"}'s resignation dated ${resignFormatted}, the resignation has been accepted and they have been relieved from their duties effective ${lastDayFormatted}.`
                : `Their employment with ${companySettings.name} has come to an end effective ${lastDayFormatted} as per the terms of the employment agreement.`
            }\n\n` +
            `During their tenure, ${form.recipientName?.split(" ")[0] || "the employee"} demonstrated professionalism and commitment to their responsibilities. ` +
            (form.remarks ? `${form.remarks}\n\n` : "\n") +
            `We wish ${form.recipientName?.split(" ")[0] || "them"} all the best in future endeavors.\n\n` +
            `Please note that all company assets, access credentials, and confidential information have been duly returned and/or revoked.`;

        const lines = doc.splitTextToSize(body, 170);
        doc.text(lines, 20, 94);

        doc.text("Yours sincerely,", 20, 195);

        // Add signature if exists
        if (companySettings.signature) {
            try {
                doc.addImage(companySettings.signature, "PNG", 20, 198, 30, 15);
            } catch (e) {
                console.error("Failed to add signature to PDF:", e);
            }
        }

        doc.setFont("helvetica", "bold");
        doc.text("Director of Human Resources", 20, 222);
        doc.setFont("helvetica", "normal"); doc.setTextColor(100, 116, 139);
        doc.text(companySettings.name, 20, 228);

        doc.save(`Relieving_Letter_${(form.recipientName || "employee").replace(/\s+/g, "_")}.pdf`);

        const fd = new FormData();
        fd.append("type", "RELIEVING");
        fd.append("recipientName", form.recipientName || "Unknown");
        fd.append("employeeId", selectedEmpId);
        fd.append("details", `Last Working Day: ${lastDayFormatted}, Reason: ${form.reason}`);
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
                    <div className="h-10 w-10 rounded-xl bg-rose-600 flex items-center justify-center">
                        <UserMinus className="h-5 w-5 text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Relieving Letter</h1>
                        <p className="text-slate-500">Process exit documentation for departing employees.</p>
                    </div>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card className="border-slate-200 dark:border-slate-800">
                    <CardHeader>
                        <CardTitle>Exit Details</CardTitle>
                        <CardDescription>Select an employee to generate the relieving letter.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label>Select Employee</Label>
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
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label>Designation</Label>
                                <Input placeholder="Role" value={form.designation}
                                    onChange={e => setForm({ ...form, designation: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                                <Label>Department</Label>
                                <Input placeholder="Dept." value={form.department}
                                    onChange={e => setForm({ ...form, department: e.target.value })} />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Exit Reason</Label>
                            <Select value={form.reason} onValueChange={v => setForm({ ...form, reason: v })}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="resignation">Resignation</SelectItem>
                                    <SelectItem value="termination">Termination</SelectItem>
                                    <SelectItem value="contract_end">Contract End</SelectItem>
                                    <SelectItem value="retirement">Retirement</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            {form.reason === "resignation" && (
                                <div className="space-y-2">
                                    <Label>Resignation Date</Label>
                                    <DatePicker
                                        value={form.resignationDate ? new Date(form.resignationDate) : undefined}
                                        onChange={(date) => setForm({ ...form, resignationDate: date ? format(date, "yyyy-MM-dd") : "" })}
                                    />
                                </div>
                            )}
                            <div className="space-y-2">
                                <Label>Last Working Day *</Label>
                                <DatePicker
                                    value={form.lastWorkingDay ? new Date(form.lastWorkingDay) : undefined}
                                    onChange={(date) => setForm({ ...form, lastWorkingDay: date ? format(date, "yyyy-MM-dd") : "" })}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Additional Remarks (optional)</Label>
                            <Textarea
                                placeholder="e.g. Their contributions to the team were exemplary."
                                value={form.remarks}
                                onChange={e => setForm({ ...form, remarks: e.target.value })}
                                rows={2}
                            />
                        </div>
                        <Button
                            className="w-full gap-2 bg-rose-600 hover:bg-rose-700 h-11 font-bold shadow-lg shadow-rose-200 dark:shadow-none"
                            onClick={handleGenerate}
                            disabled={loading || !form.recipientName || !form.lastWorkingDay}
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
                            <div className="h-8 rounded bg-rose-600 flex items-center justify-center">
                                <Building2 className="h-4 w-4 text-white" />
                            </div>
                            <div className="text-center">
                                <div className="text-[8px] font-bold text-rose-600 uppercase tracking-wide">Relieving Letter</div>
                            </div>
                            <div className="space-y-1.5">
                                {[1, 0.7, 0.9, 0.6, 0.8, 0.75, 0.9, 0.65].map((w, i) => (
                                    <div key={i} className="h-1.5 rounded bg-slate-200 dark:bg-slate-700" style={{ width: `${w * 100}%` }} />
                                ))}
                            </div>
                        </div>
                        <div className="text-sm font-medium text-slate-500">
                            {form.recipientName ? (
                                <span>Ready for <span className="text-rose-600 font-bold">{form.recipientName}</span></span>
                            ) : "Select an employee to generate"}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
