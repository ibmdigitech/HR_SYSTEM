"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getLetterTemplates, createLetterTemplate, updateLetterTemplate, deleteLetterTemplate } from "@/app/lib/actions/letter-templates";
import { FileText, Plus, Save, Trash2, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function TemplatesPage() {
    const [templates, setTemplates] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTemplate, setSelectedTemplate] = useState<any | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    // Form state
    const [name, setName] = useState("");
    const [type, setType] = useState("EMPLOYMENT");
    const [contentEn, setContentEn] = useState("");
    const [contentAr, setContentAr] = useState("");

    useEffect(() => {
        loadTemplates();
    }, []);

    const loadTemplates = async () => {
        setLoading(true);
        const res = await getLetterTemplates();
        if (res.success) {
            setTemplates(res.data);
            if (res.data.length > 0 && !selectedTemplate) {
                selectTemplate(res.data[0]);
            }
        } else {
            toast.error("Failed to load templates");
        }
        setLoading(false);
    };

    const selectTemplate = (t: any) => {
        setSelectedTemplate(t);
        setName(t.name);
        setType(t.type);
        setContentEn(t.content_en);
        setContentAr(t.content_ar || "");
    };

    const handleNew = () => {
        setSelectedTemplate(null);
        setName("");
        setType("EMPLOYMENT");
        setContentEn("Dear {{employee_name}},\n\n");
        setContentAr("");
    };

    const handleSave = async () => {
        if (!name || !contentEn) {
            toast.error("Name and English content are required");
            return;
        }

        setIsSaving(true);
        const data = { name, type, content_en: contentEn, content_ar: contentAr };

        if (selectedTemplate) {
            const res = await updateLetterTemplate(selectedTemplate.id, data);
            if (res.success) {
                toast.success("Template updated");
                loadTemplates();
            } else {
                toast.error(res.error || "Update failed");
            }
        } else {
            const res = await createLetterTemplate(data);
            if (res.success) {
                toast.success("Template created");
                loadTemplates();
                setSelectedTemplate(res.data);
            } else {
                toast.error(res.error || "Creation failed");
            }
        }
        setIsSaving(false);
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this template?")) return;
        const res = await deleteLetterTemplate(id);
        if (res.success) {
            toast.success("Deleted successfully");
            if (selectedTemplate?.id === id) {
                handleNew();
            }
            loadTemplates();
        } else {
            toast.error("Failed to delete");
        }
    };

    // Quick seed for testing/convenience
    const handleSeed = async () => {
        const seedTemplates = [
            {
                name: "Standard Employment Certificate",
                type: "EMPLOYMENT",
                content_en: "To Whom It May Concern,\n\nThis is to certify that {{employee_name}} (Employee ID: {{employee_id}}) is currently employed with {{company_name}} in the capacity of {{designation}} within the {{department}} department, effective from {{joining_date}}.\n\nThis certificate is issued upon the employee's request without any financial or legal liability towards {{company_name}}.\n\nSincerely,\nHR Department",
            },
            {
                name: "Salary Certificate",
                type: "PAYROLL",
                content_en: "To Whom It May Concern,\n\nThis is to certify that {{employee_name}} holding Passport No. {{passport_number}} is employed with {{company_name}} as a {{designation}}.\n\nThe current salary breakdown is as follows:\nBasic Salary: AED {{basic_salary}}\nAllowances: AED {{allowances}}\nGross Salary: AED {{gross_salary}}\n\nThis certificate is issued upon the employee's request.",
            },
            {
                name: "Travel NOC",
                type: "NOC",
                content_en: "To Whom It May Concern,\n\n{{company_name}} has no objection to our employee {{employee_name}}, holding Passport No. {{passport_number}}, travelling for vacation/tourism purposes.\n\nThey are expected to resume duties after their approved leave.",
            }
        ];

        setIsSaving(true);
        for (const t of seedTemplates) {
            await createLetterTemplate(t);
        }
        toast.success("Seeded initial templates!");
        loadTemplates();
        setIsSaving(false);
    };

    return (
        <div className="space-y-6 p-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Template Builder</h1>
                    <p className="text-slate-500 dark:text-slate-400">Manage standard letter templates and variables.</p>
                </div>
                <div className="flex gap-2">
                    {templates.length === 0 && (
                        <Button onClick={handleSeed} variant="outline" className="border-indigo-200 text-indigo-600 bg-indigo-50">
                            <Sparkles className="h-4 w-4 mr-2" />
                            Seed Defaults
                        </Button>
                    )}
                    <Button onClick={handleNew} className="bg-indigo-600 hover:bg-indigo-700">
                        <Plus className="h-4 w-4 mr-2" />
                        New Template
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-12 gap-6">
                {/* Sidebar list */}
                <Card className="col-span-12 md:col-span-4">
                    <CardHeader className="p-4 border-b">
                        <CardTitle className="text-lg">Templates</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0 max-h-[600px] overflow-y-auto">
                        {loading ? (
                            <div className="p-8 flex justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
                        ) : templates.length === 0 ? (
                            <div className="p-8 text-center text-slate-500 text-sm">No templates found. Click New or Seed.</div>
                        ) : (
                            <div className="flex flex-col">
                                {templates.map((t) => (
                                    <div 
                                        key={t.id} 
                                        onClick={() => selectTemplate(t)}
                                        className={`p-4 border-b border-slate-100 cursor-pointer hover:bg-slate-50 flex items-start justify-between group ${selectedTemplate?.id === t.id ? 'bg-indigo-50/50 border-l-4 border-l-indigo-600' : 'border-l-4 border-l-transparent'}`}
                                    >
                                        <div>
                                            <p className="font-semibold text-sm text-slate-900">{t.name}</p>
                                            <p className="text-[10px] uppercase font-bold text-slate-400 mt-1">{t.type}</p>
                                        </div>
                                        <Button 
                                            variant="ghost" 
                                            size="icon" 
                                            onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }}
                                            className="h-8 w-8 text-slate-400 hover:text-rose-600 opacity-0 group-hover:opacity-100"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Editor */}
                <Card className="col-span-12 md:col-span-8">
                    <CardHeader className="p-6 border-b bg-slate-50/50">
                        <div className="flex justify-between items-center">
                            <div>
                                <CardTitle>{selectedTemplate ? 'Edit Template' : 'Create Template'}</CardTitle>
                                <CardDescription>Use variables like {'{{employee_name}}'}</CardDescription>
                            </div>
                            <Button onClick={handleSave} disabled={isSaving} className="bg-emerald-600 hover:bg-emerald-700">
                                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                                Save Template
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="p-6 space-y-6">
                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <Label>Template Name</Label>
                                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Salary Certificate" />
                            </div>
                            <div className="space-y-2">
                                <Label>Category</Label>
                                <Select value={type} onValueChange={setType}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="EMPLOYMENT">Employment</SelectItem>
                                        <SelectItem value="PAYROLL">Payroll</SelectItem>
                                        <SelectItem value="NOC">NOC</SelectItem>
                                        <SelectItem value="DISCIPLINARY">Disciplinary</SelectItem>
                                        <SelectItem value="WARNING">Warning</SelectItem>
                                        <SelectItem value="REWARD">Reward & Recognition</SelectItem>
                                        <SelectItem value="EXIT">Exit / Termination</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label className="flex justify-between">
                                <span>English Content</span>
                                <span className="text-xs text-slate-400 font-normal">Available: {'{{company_name}}'}, {'{{employee_name}}'}, {'{{designation}}'}, {'{{basic_salary}}'}, etc.</span>
                            </Label>
                            <Textarea 
                                value={contentEn} 
                                onChange={(e) => setContentEn(e.target.value)} 
                                className="min-h-[250px] font-mono text-sm leading-relaxed"
                                placeholder="Dear {{employee_name}}, ..."
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Arabic Content (Optional)</Label>
                            <Textarea 
                                value={contentAr} 
                                onChange={(e) => setContentAr(e.target.value)} 
                                className="min-h-[150px] font-mono text-sm leading-relaxed"
                                dir="rtl"
                                placeholder="محتوى الرسالة باللغة العربية..."
                            />
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
