"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    FileUp,
    CheckCircle2,
    AlertCircle,
    Calendar,
    Globe,
    User,
    FileText,
    CreditCard,
    Stethoscope,
    FileDigit as Passport,
    ShieldCheck,
    ShieldAlert
} from "lucide-react";
import { submitVisaRequest } from "@/app/lib/actions/visa";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const VISA_CATEGORIES = [
    { id: "EID_PHOTO", label: "EID Photo", icon: User, description: "Recent photo for Emirates ID" },
    { id: "PASSPORT_PHOTO", label: "Passport Photo", icon: Passport, description: "Standard passport size photo" },
    { id: "VISA_COPY", label: "Visa Copy", icon: Globe, description: "Current/Previous visa page" },
    { id: "EID_REQUEST_FORM", label: "EID Request Form", icon: FileText, description: "Official EID application form" },
    { id: "MEDICAL_PAYMENT_BILL", label: "Medical Bill", icon: Stethoscope, description: "Receipt of medical insurance/test" },
    { id: "PASSPORT_COPY", label: "Passport Copy", icon: FileUp, description: "Main page with biometric details" },
    { id: "REQUEST_FORM", label: "Request Form", icon: FileText, description: "Visa processing request form" },
    { id: "MEDICAL_INSURANCE", label: "Medical Ins.", icon: ShieldCheck, description: "Medical insurance certificate" },
    { id: "ILOE_INSURANCE", label: "ILOE Ins.", icon: ShieldAlert, description: "Involuntary Loss of Employment insurance" },
];

export default function VisaRequestPage() {
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
        } catch (error: any) {
            setLoading(false);
            toast.error(`Failed to submit: ${error.message || 'Unknown error'}`);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Visa & Compliance</h1>
                    <p className="text-slate-500 dark:text-slate-400">Manage visa requests and monitor document validity.</p>
                </div>
                <div className="flex gap-2">
                    <Badge variant="outline" className="px-3 py-1 gap-2 bg-amber-50 text-amber-700 border-amber-200">
                        <AlertCircle className="h-4 w-4" />
                        Check Expiries
                    </Badge>
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
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
                                        className="py-2 px-1 text-[9px] flex flex-col gap-1 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-950"
                                    >
                                        <cat.icon className={cn("h-3.5 w-3.5", files[cat.id] ? "text-emerald-500" : "text-slate-500")} />
                                        <span className="truncate w-full">{cat.label}</span>
                                    </TabsTrigger>
                                ))}
                            </TabsList>
                            <ScrollArea className="mt-4 h-[350px] border rounded-lg p-6 bg-slate-50/50 dark:bg-slate-900/50">
                                {VISA_CATEGORIES.map((cat) => (
                                    <TabsContent key={cat.id} value={cat.id} className="mt-0 focus-visible:ring-0">
                                        <div className="flex flex-col items-center justify-center text-center space-y-4">
                                            <div className={cn(
                                                "h-14 w-14 rounded-2xl flex items-center justify-center transition-colors",
                                                files[cat.id] ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-indigo-50 dark:bg-indigo-900/20"
                                            )}>
                                                <cat.icon className={cn(
                                                    "h-7 w-7",
                                                    files[cat.id] ? "text-emerald-600 dark:text-emerald-400" : "text-indigo-600 dark:text-indigo-400"
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
                                                        files[cat.id] ? "border-emerald-500/50 hover:border-emerald-500" : "border-slate-200 dark:border-slate-800 hover:border-indigo-500"
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

                <div className="space-y-6">
                    <Card className="border-indigo-100 dark:border-indigo-900/50 overflow-hidden">
                        <CardHeader className="bg-indigo-50/50 dark:bg-indigo-900/10">
                            <CardTitle className="text-sm flex items-center gap-2">
                                <ShieldCheck className="h-4 w-4 text-indigo-600" />
                                Compliance Status
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4 space-y-3">
                            {/* Passport */}
                            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <Passport className="h-3.5 w-3.5" />
                                        <span className="text-[10px] font-bold uppercase tracking-tighter">Passport Validity</span>
                                    </div>
                                    <Badge className="text-[9px] h-4 bg-emerald-500 hover:bg-emerald-500 text-white border-0">Safe</Badge>
                                </div>
                                <div className="flex justify-between items-end">
                                    <div>
                                        <p className="text-2xl font-black leading-none">732</p>
                                        <p className="text-[9px] font-medium opacity-70">Days Remaining</p>
                                    </div>
                                    <p className="text-[10px] font-bold">12 Jan 2028</p>
                                </div>
                            </div>

                            {/* Visa */}
                            <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 border border-blue-100 dark:border-blue-900/30">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <Globe className="h-3.5 w-3.5" />
                                        <span className="text-[10px] font-bold uppercase tracking-tighter">Visa Validity</span>
                                    </div>
                                    <Badge className="text-[9px] h-4 bg-blue-500 hover:bg-blue-500 text-white border-0">Active</Badge>
                                </div>
                                <div className="flex justify-between items-end">
                                    <div>
                                        <p className="text-2xl font-black leading-none">120</p>
                                        <p className="text-[9px] font-medium opacity-70">Days Remaining</p>
                                    </div>
                                    <p className="text-[10px] font-bold">11 May 2026</p>
                                </div>
                            </div>

                            {/* Medical Insurance */}
                            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-100 dark:border-amber-900/30">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <Stethoscope className="h-3.5 w-3.5" />
                                        <span className="text-[10px] font-bold uppercase tracking-tighter">Medical Insurance</span>
                                    </div>
                                    <Badge className="text-[9px] h-4 bg-amber-500 hover:bg-amber-500 text-white border-0">Action Req</Badge>
                                </div>
                                <div className="flex justify-between items-end">
                                    <div>
                                        <p className="text-2xl font-black leading-none text-amber-600">28</p>
                                        <p className="text-[9px] font-medium opacity-70">Days Remaining</p>
                                    </div>
                                    <p className="text-[10px] font-bold">08 Feb 2026</p>
                                </div>
                            </div>

                            {/* ILOE */}
                            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 text-slate-700 dark:text-slate-400 border border-slate-100 dark:border-slate-800">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <ShieldAlert className="h-3.5 w-3.5" />
                                        <span className="text-[10px] font-bold uppercase tracking-tighter">ILOE Insurance</span>
                                    </div>
                                    <Badge variant="outline" className="text-[9px] h-4">Verified</Badge>
                                </div>
                                <div className="flex justify-between items-end">
                                    <div>
                                        <p className="text-2xl font-black leading-none italic">-</p>
                                        <p className="text-[9px] font-medium opacity-70">N/A</p>
                                    </div>
                                    <p className="text-[10px] font-bold">Add Policy</p>
                                </div>
                            </div>

                            <div className="mt-4 p-4 rounded-xl border-2 border-dashed border-slate-100 dark:border-slate-800 bg-slate-50/30">
                                <div className="flex gap-2">
                                    <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                                    <p className="text-[11px] font-medium leading-relaxed">
                                        Notifications are sent **30 days** and **7 days** before any document expiry. Please ensure all uploads are current.
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm">Request Archive</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-center py-6 text-slate-400 italic text-[11px]">
                                No application history available.
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
