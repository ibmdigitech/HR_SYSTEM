"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";import { ScrollArea } from "@/components/ui/scroll-area";
import {
    FileUp,
    CheckCircle2,
    AlertCircle,
    Globe,
    User,
    FileText,
    Stethoscope,
    FileDigit as Passport,
    ShieldCheck,
    ShieldAlert
} from "lucide-react";
import { submitVisaRequest } from "@/app/lib/actions/visa";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const VISA_CATEGORIES = [
    { id: "EID_PHOTO", label: "EID Photo", icon: User, description: "Recent photo for Emirates ID", color: "text-blue-500", bg: "bg-blue-100", border: "border-blue-200" },
    { id: "PASSPORT_PHOTO", label: "Passport Photo", icon: Passport, description: "Standard passport size photo", color: "text-violet-500", bg: "bg-violet-100", border: "border-violet-200" },
    { id: "VISA_COPY", label: "Visa Copy", icon: Globe, description: "Current/Previous visa page", color: "text-emerald-500", bg: "bg-emerald-100", border: "border-emerald-200" },
    { id: "EID_REQUEST_FORM", label: "EID Request Form", icon: FileText, description: "Official EID application form", color: "text-amber-500", bg: "bg-amber-100", border: "border-amber-200" },
    { id: "MEDICAL_PAYMENT_BILL", label: "Medical Bill", icon: Stethoscope, description: "Receipt of medical insurance/test", color: "text-rose-500", bg: "bg-rose-100", border: "border-rose-200" },
    { id: "PASSPORT_COPY", label: "Passport Copy", icon: FileUp, description: "Main page with biometric details", color: "text-indigo-500", bg: "bg-indigo-100", border: "border-indigo-200" },
    { id: "REQUEST_FORM", label: "Request Form", icon: FileText, description: "Visa processing request form", color: "text-cyan-500", bg: "bg-cyan-100", border: "border-cyan-200" },
    { id: "MEDICAL_INSURANCE", label: "Medical Ins.", icon: ShieldCheck, description: "Medical insurance certificate", color: "text-teal-500", bg: "bg-teal-100", border: "border-teal-200" },
    { id: "ILOE_INSURANCE", label: "ILOE Ins.", icon: ShieldAlert, description: "Involuntary Loss of Employment insurance", color: "text-fuchsia-500", bg: "bg-fuchsia-100", border: "border-fuchsia-200" },
];

export function VisaForm() {
    const [files, setFiles] = useState<Record<string, File | null>>({});
    const [docData, setDocData] = useState<Record<string, { number: string, expiry: string }>>({});
    const [loading, setLoading] = useState(false);
    const [destination, setDestination] = useState("");
    const [visaType, setVisaType] = useState("");

    const handleFileChange = (category: string, e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFiles(prev => ({ ...prev, [category]: e.target.files![0] }));
        }
    };

    const handleDocDataChange = (category: string, field: 'number' | 'expiry', value: string) => {
        setDocData(prev => ({
            ...prev,
            [category]: {
                ...(prev[category] || { number: '', expiry: '' }),
                [field]: value
            }
        }));
    };

    const handleSubmit = async () => {
        if (!destination || !visaType) {
            toast.error('Please fill in destination and visa type');
            return;
        }
        if (Object.keys(files).length === 0) {
            toast.error('Please upload at least one document');
            return;
        }

        setLoading(true);
        const formData = new FormData();
        formData.append("destinationCountry", destination);
        formData.append("visaType", visaType);
        formData.append("purpose", "Visa Request");

        Object.entries(files).forEach(([category, file]) => {
            if (file) {
                formData.append(category, file);
                formData.append(`${category}_number`, docData[category]?.number || "");
                formData.append(`${category}_expiry`, docData[category]?.expiry || "");
            }
        });

        try {
            const result = await submitVisaRequest(formData);
            setLoading(false);

            if (result.success) {
                toast.success(result.message);
                setFiles({});
                setDocData({});
                setDestination("");
                setVisaType("");
            } else {
                toast.error(result.message);
            }
        } catch (error: unknown) {
            setLoading(false);
            toast.error(`Failed to submit: ${(error instanceof Error ? error.message : "Unknown error") || 'Unknown error'}`);
        }
    };

    return (
        <Card className="lg:col-span-2">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle>Document Submission</CardTitle>
                        <CardDescription>Upload required documents for processing.</CardDescription>
                    </div>
                    <span className="text-xs font-medium text-slate-400">{Object.keys(files).length} / 9 Added</span>
                </div>
            </CardHeader>
            <CardContent>
                <Tabs defaultValue="EID_PHOTO" className="w-full">
                    <TabsList className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 h-auto p-1 bg-slate-100 dark:bg-slate-800">
                        {VISA_CATEGORIES.map((cat) => (
                            <TabsTrigger
                                key={cat.id}
                                value={cat.id}
                                className="py-2 px-1 text-[9px] flex flex-col gap-1 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-950 transition-colors hover:bg-slate-50"
                            >
                                <cat.icon className={cn("h-3.5 w-3.5", files[cat.id] ? "text-emerald-500" : cat.color)} />
                                <span className="truncate w-full">{cat.label}</span>
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    <ScrollArea className="mt-4 h-[350px] border rounded-lg p-6 bg-slate-50/50 dark:bg-slate-900/50">
                        {VISA_CATEGORIES.map((cat) => (
                            <TabsContent key={cat.id} value={cat.id} className="mt-0 focus-visible:ring-0">
                                <div className="flex flex-col items-center justify-center text-center space-y-4">
                                    <div className={cn(
                                        "h-14 w-14 rounded-2xl flex items-center justify-center transition-colors shadow-sm",
                                        files[cat.id] ? "bg-emerald-100 dark:bg-emerald-900/30" : cat.bg
                                    )}>
                                        <cat.icon className={cn(
                                            "h-7 w-7",
                                            files[cat.id] ? "text-emerald-600 dark:text-emerald-400" : cat.color
                                        )} />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-slate-900 dark:text-white">{cat.label}</h4>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-[200px]">{cat.description}</p>
                                    </div>

                                    <div className="w-full max-w-[320px] space-y-4">
                                        <Label htmlFor={`file-${cat.id}`} className="cursor-pointer block">
                                            <div className={cn(
                                                "border-2 border-dashed rounded-xl p-4 transition-all bg-white dark:bg-slate-950",
                                                files[cat.id] ? "border-emerald-500/50 hover:border-emerald-500" : `hover:${cat.border} border-slate-200 dark:border-slate-800`
                                            )}>
                                                {files[cat.id] ? (
                                                    <div className="flex flex-col items-center gap-1">
                                                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                                                        <span className="text-[10px] truncate max-w-full font-bold text-emerald-700 dark:text-emerald-400">
                                                            {files[cat.id]?.name}
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <div className="flex flex-col items-center gap-1 text-slate-400">
                                                        <FileUp className="h-5 w-5" />
                                                        <span className="text-[10px] font-medium uppercase tracking-wider">Drag or Click to Upload</span>
                                                    </div>
                                                )}
                                            </div>
                                            <Input
                                                id={`file-${cat.id}`}
                                                type="file"
                                                className="hidden"
                                                onChange={(e) => handleFileChange(cat.id, e)}
                                            />
                                        </Label>

                                        <div className="grid grid-cols-2 gap-3 pb-4">
                                            <div className="space-y-1.5 text-left">
                                                <Label className="text-[10px] uppercase font-bold text-slate-500">Doc Number</Label>
                                                <Input
                                                    placeholder="Number"
                                                    value={docData[cat.id]?.number || ""}
                                                    onChange={(e) => handleDocDataChange(cat.id, 'number', e.target.value)}
                                                    className="h-8 text-xs bg-white dark:bg-slate-950"
                                                />
                                            </div>
                                            <div className="space-y-1.5 text-left">
                                                <Label className="text-[10px] uppercase font-bold text-slate-500">Expiry Date</Label>
                                                <Input
                                                    type="date"
                                                    value={docData[cat.id]?.expiry || ""}
                                                    onChange={(e) => handleDocDataChange(cat.id, 'expiry', e.target.value)}
                                                    className="h-8 text-xs bg-white dark:bg-slate-950"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </TabsContent>
                        ))}
                    </ScrollArea>
                </Tabs>

                <div className="grid grid-cols-2 gap-4 mt-6">
                    <div className="space-y-2">
                        <Label className="text-xs uppercase font-bold text-slate-500">Destination</Label>
                        <Input
                            placeholder="e.g. UAE"
                            value={destination}
                            onChange={(e) => setDestination(e.target.value)}
                            className="bg-slate-50/50 dark:bg-slate-900/50"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-xs uppercase font-bold text-slate-500">Request Type</Label>
                        <Input
                            placeholder="e.g. New Visa / Renewal"
                            value={visaType}
                            onChange={(e) => setVisaType(e.target.value)}
                            className="bg-slate-50/50 dark:bg-slate-900/50"
                        />
                    </div>
                </div>

                <Button
                    className="w-full mt-6 bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-12 rounded-xl transition-all shadow-lg shadow-indigo-200 dark:shadow-none"
                    disabled={loading || Object.keys(files).length === 0}
                    onClick={handleSubmit}
                >
                    {loading ? "Processing..." : "Submit Complete Application"}
                </Button>
            </CardContent>
        </Card>
    );
}
