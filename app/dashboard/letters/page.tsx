"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Download, User, Calendar, Briefcase, Building2 } from "lucide-react";
import jsPDF from "jspdf";

export default function LetterGeneratorPage() {
    const [letterType, setLetterType] = useState("OFFER");
    const [formData, setFormData] = useState({
        employeeName: "",
        designation: "",
        joiningDate: "",
        salary: "",
        companyName: "IBMDIGITECH",
    });

    const generatePDF = () => {
        const doc = new jsPDF();

        // Add Company Logo/Header
        doc.setFontSize(22);
        doc.setTextColor(79, 70, 229); // Indigo-600
        doc.text(formData.companyName, 105, 20, { align: "center" });

        doc.setFontSize(10);
        doc.setTextColor(100, 116, 139); // Slate-500
        doc.text("Human Resources Department", 105, 28, { align: "center" });

        doc.setDrawColor(226, 232, 240); // Slate-200
        doc.line(20, 35, 190, 35);

        // Content
        doc.setFontSize(16);
        doc.setTextColor(15, 23, 42); // Slate-900
        const title = letterType === "OFFER" ? "LETTER OF OFFER" : letterType === "APPOINTMENT" ? "APPOINTMENT LETTER" : "RELIEVING LETTER";
        doc.text(title, 105, 50, { align: "center" });

        doc.setFontSize(12);
        doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, 65);
        doc.text(`To,`, 20, 80);
        doc.setFontSize(14);
        doc.text(`${formData.employeeName || "[Employee Name]"}`, 20, 88);

        doc.setFontSize(12);
        let content = "";
        if (letterType === "OFFER") {
            content = `Dear ${formData.employeeName || "Candidate"},\n\nWe are pleased to offer you the position of ${formData.designation || "[Designation]"} at ${formData.companyName}. Your contribution will be vital for our growth.\n\nJoining Date: ${formData.joiningDate || "[Date]"}\nAnnual CTC: ${formData.salary ? "$" + formData.salary : "[Salary]"}\n\nWe look forward to having you on board!`;
        } else if (letterType === "APPOINTMENT") {
            content = `Dear ${formData.employeeName || "Employee"},\n\nFollowing up on our offer, we are happy to formally appoint you as ${formData.designation || "[Designation]"}. You will report to the department manager starting ${formData.joiningDate || "[Date]"}.\n\nWelcome to the IBMDIGITECH family.`;
        } else {
            content = `To Whom It May Concern,\n\nThis is to certify that ${formData.employeeName || "[Employee Name]"} was employed with ${formData.companyName} as ${formData.designation || "[Designation]"} from [Start Date] to [End Date].\n\nDuring their tenure, they demonstrated excellence and integrity. We wish them success in future endeavors.`;
        }

        const splitText = doc.splitTextToSize(content, 170);
        doc.text(splitText, 20, 105);

        // Sign-off
        doc.text("Sincerely,", 20, 200);
        doc.setFontSize(14);
        doc.text("Director of HR", 20, 215);
        doc.setFontSize(12);
        doc.text(formData.companyName, 20, 222);

        doc.save(`${formData.employeeName}_${letterType}.pdf`);
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Letter Generator</h1>
                <p className="text-slate-500 dark:text-slate-400">Generate professional HR documents instantly.</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Document Details</CardTitle>
                        <CardDescription>Fill in the details to generate the PDF</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label>Letter Type</Label>
                            <Select value={letterType} onValueChange={setLetterType}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select type" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="OFFER">Offer Letter</SelectItem>
                                    <SelectItem value="APPOINTMENT">Appointment Letter</SelectItem>
                                    <SelectItem value="RELIEVING">Relieving Letter</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Employee Name</Label>
                            <Input
                                placeholder="Enter full name"
                                value={formData.employeeName}
                                onChange={(e) => setFormData({ ...formData, employeeName: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Designation</Label>
                            <Input
                                placeholder="e.g. Senior Developer"
                                value={formData.designation}
                                onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Date</Label>
                                <Input
                                    type="date"
                                    value={formData.joiningDate}
                                    onChange={(e) => setFormData({ ...formData, joiningDate: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Salary / Info</Label>
                                <Input
                                    placeholder="e.g. 60,000"
                                    value={formData.salary}
                                    onChange={(e) => setFormData({ ...formData, salary: e.target.value })}
                                />
                            </div>
                        </div>
                        <Button className="w-full gap-2 mt-4" onClick={generatePDF}>
                            <Download className="h-4 w-4" />
                            Generate & Download PDF
                        </Button>
                    </CardContent>
                </Card>

                <div className="space-y-6">
                    <Card className="bg-slate-50 dark:bg-slate-900 border-dashed border-2 flex items-center justify-center p-8 min-h-[400px]">
                        <div className="text-center space-y-4">
                            <div className="h-16 w-16 bg-white dark:bg-slate-800 rounded-2xl shadow-sm flex items-center justify-center mx-auto">
                                <FileText className="h-8 w-8 text-indigo-600" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-lg">Live Preview Coming Soon</h3>
                                <p className="text-sm text-slate-500 max-w-[250px] mx-auto">Download the PDF to see the professional formatting and IBMDIGITECH branding.</p>
                            </div>
                        </div>
                    </Card>

                    <div className="grid grid-cols-2 gap-4">
                        <Card className="p-4 flex items-center gap-3">
                            <div className="h-10 w-10 rounded-lg bg-emerald-100 dark:bg-emerald-900 shrink-0 flex items-center justify-center">
                                <User className="h-5 w-5 text-emerald-600" />
                            </div>
                            <div className="text-xs">
                                <p className="font-semibold text-slate-500 uppercase">Total Generated</p>
                                <p className="text-lg font-bold">124</p>
                            </div>
                        </Card>
                        <Card className="p-4 flex items-center gap-3">
                            <div className="h-10 w-10 rounded-lg bg-indigo-100 dark:bg-indigo-900 shrink-0 flex items-center justify-center">
                                <Building2 className="h-5 w-5 text-indigo-600" />
                            </div>
                            <div className="text-xs">
                                <p className="font-semibold text-slate-500 uppercase">Active Templates</p>
                                <p className="text-lg font-bold">3</p>
                            </div>
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    );
}
