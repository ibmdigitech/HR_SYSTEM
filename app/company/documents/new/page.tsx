"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { createCompanyDocument } from "@/app/lib/actions/company-documents";
import { FileText, ArrowLeft, Upload } from "lucide-react";
import Link from "next/link";

export default function NewCompanyDocumentPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);

    async function handleSubmit(formData: FormData) {
        setLoading(true);
        try {
            const res = await createCompanyDocument(formData);
            if (res.success) {
                toast.success("Document uploaded successfully");
                router.push("/company/documents");
            } else {
                toast.error(res.error || "Failed to upload document");
            }
        } catch (e) {
            toast.error("An unexpected error occurred");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-3xl mx-auto">
            <div className="flex items-center gap-4">
                <Link href="/company/documents">
                    <Button variant="ghost" size="icon" className="rounded-xl">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <div>
                    <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">Upload Document</h1>
                    <p className="text-slate-500 text-sm font-medium">Add a new policy, handbook, or procedure</p>
                </div>
            </div>

            <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800/60 shadow-sm rounded-2xl">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-slate-600" />
                        Document Details
                    </CardTitle>
                    <CardDescription>Enter the metadata and file location for this document</CardDescription>
                </CardHeader>
                <CardContent>
                    <form action={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="title">Document Title</Label>
                            <Input id="title" name="title" placeholder="e.g. Employee Code of Conduct" required />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="type">Type</Label>
                                <Select name="type" required defaultValue="POLICY">
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select type" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="POLICY">Policy</SelectItem>
                                        <SelectItem value="HANDBOOK">Handbook</SelectItem>
                                        <SelectItem value="PROCEDURE">Procedure</SelectItem>
                                        <SelectItem value="FORM">Form</SelectItem>
                                        <SelectItem value="OTHER">Other</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="category">Category</Label>
                                <Select name="category" required defaultValue="GENERAL">
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select category" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="HR">HR</SelectItem>
                                        <SelectItem value="FINANCE">Finance</SelectItem>
                                        <SelectItem value="IT">IT</SelectItem>
                                        <SelectItem value="LEGAL">Legal</SelectItem>
                                        <SelectItem value="GENERAL">General</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="description">Description</Label>
                            <Textarea id="description" name="description" placeholder="Brief description of the document..." rows={3} />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="fileUrl">File URL</Label>
                            <Input id="fileUrl" name="fileUrl" placeholder="https://example.com/documents/policy.pdf" required />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="fileName">File Name</Label>
                                <Input id="fileName" name="fileName" placeholder="policy.pdf" required />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="fileType">File Type</Label>
                                <Input id="fileType" name="fileType" placeholder="application/pdf" required />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="version">Version</Label>
                                <Input id="version" name="version" placeholder="1.0" defaultValue="1.0" />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="effectiveFrom">Effective From</Label>
                                <DatePicker id="effectiveFrom" name="effectiveFrom" aria-label="Effective from date" />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="effectiveTo">Effective To (optional)</Label>
                            <DatePicker id="effectiveTo" name="effectiveTo" aria-label="Effective to date" />
                        </div>

                        <div className="flex justify-end gap-3 pt-4">
                            <Link href="/company/documents">
                                <Button type="button" variant="outline">Cancel</Button>
                            </Link>
                            <Button type="submit" disabled={loading} className="gap-2">
                                {loading ? "Uploading..." : "Upload Document"}
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
