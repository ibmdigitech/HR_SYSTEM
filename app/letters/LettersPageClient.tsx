"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
    FileText, 
    Plus, 
    Search, 
    Filter, 
    Download as DownloadIcon, 
    Eye, 
    CheckCircle2, 
    Clock, 
    AlertCircle, 
    ArrowRight, 
    Languages,
    Building2,
    Stamp,
    UserCheck,
    Printer,
    Mail,
    Send,
    ChevronRight,
    Loader2
} from "lucide-react";
import { generateLetterPDF } from "@/app/lib/utils/letter-generator";
import {
    getLetterEmployeeDisplayName,
    getLetterEmployeeInitials,
} from "@/app/lib/letters-safe";

interface Template {
    id: string;
    name: string;
    type: string;
    content_en: string;
    content_ar: string | null;
}

interface Letter {
    id: string;
    referenceNumber: string;
    status: string;
    template: { name: string; type: string };
    employee: { firstName: string; lastName: string; rollNumber: string };
    createdAt: string;
    content_en: string;
    content_ar: string | null;
}

interface Employee {
    id: string;
    firstName: string;
    lastName: string;
    designation: string;
}

export default function LettersPageClient({ userRole }: { userRole: string }) {
    const [templates, setTemplates] = useState<Template[]>([]);
    const [letters, setLetters] = useState<Letter[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    
    // Selection state
    const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
    const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
    const [purpose, setPurpose] = useState("");
    const [viewingLetter, setViewingLetter] = useState<Letter | null>(null);

    const isAdmin = userRole === "ADMIN" || userRole === "HR";

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [tRes, lRes, eRes] = await Promise.all([
                fetch('/api/templates').catch(e => ({ ok: false, json: () => [] })),
                fetch('/api/letters').catch(e => ({ ok: false, json: () => [] })),
                isAdmin ? fetch('/api/employees').catch(e => ({ ok: false, json: () => [] })) : Promise.resolve({ ok: true, json: async () => [] })
            ]);

            if (tRes.ok) {
                const tData = await tRes.json();
                setTemplates(Array.isArray(tData) ? tData : []);
            } else {
                toast.error("Templates service unavailable");
            }

            if (lRes.ok) {
                const lData = await lRes.json();
                setLetters(Array.isArray(lData) ? lData : []);
            }

            if (isAdmin && eRes.ok) {
                const eData = await eRes.json();
                setEmployees(Array.isArray(eData) ? eData : (eData.data || []));
            }
        } catch (error) {
            console.error("Fetch Data Error:", error);
            toast.error("Failed to load letter data engine");
        } finally {
            setLoading(false);
        }
    };

    const handleGenerate = async () => {
        if (!selectedTemplate) {
            toast.error("Please select a template");
            return;
        }

        setGenerating(true);
        try {
            const res = await fetch('/api/letters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    templateId: selectedTemplate.id,
                    // Only send an employeeId when the user actually chose one.
                    // The API resolves the caller's own employee otherwise.
                    ...(selectedEmployeeId ? { employeeId: selectedEmployeeId } : {}),
                    customFields: purpose ? { 'request.purpose': purpose } : {}
                })
            });

            const payload = await res.json().catch(() => ({}));

            if (!res.ok) {
                // Surface the server's reason instead of a blanket failure.
                toast.error(payload?.error || `Request failed (${res.status})`);
                return;
            }

            toast.success(
                payload?.status === 'PENDING'
                    ? "Letter submitted and pending approval"
                    : "Letter generated successfully"
            );
            setSelectedTemplate(null);
            setPurpose("");
            setSelectedEmployeeId("");
            // Show the new letter immediately rather than re-fetching behind a
            // spinner the user cannot see.
            await fetchData();
        } catch (error) {
            console.error('Letter generation failed', error);
            toast.error("Could not reach the letter service. Check your connection and retry.");
        } finally {
            setGenerating(false);
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'GENERATED': return <Badge className="bg-emerald-500 hover:bg-emerald-500 font-black uppercase text-[10px] tracking-widest">Ready</Badge>;
            case 'PENDING':   return <Badge className="bg-amber-500 hover:bg-amber-500 font-black uppercase text-[10px] tracking-widest">Pending HR</Badge>;
            case 'REJECTED':  return <Badge className="bg-rose-500 hover:bg-rose-500 font-black uppercase text-[10px] tracking-widest">Rejected</Badge>;
            default:          return <Badge variant="outline" className="font-black uppercase text-[10px] tracking-widest">{status}</Badge>;
        }
    };

    if (loading) {
        return (
            <div className="h-[60vh] flex flex-col items-center justify-center gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-indigo-600" />
                <p className="text-slate-500 font-black uppercase tracking-widest animate-pulse">Initializing Document Engine...</p>
            </div>
        );
    }

    return (
        <div className="space-y-10 animate-in fade-in duration-700">
            {/* Header section */}
            <div className="relative overflow-hidden bg-slate-900 p-12 rounded-[3rem] shadow-2xl">
                <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/4"></div>
                <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
                    <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-indigo-300 text-[10px] font-black uppercase tracking-[0.2em] mb-6">
                            <Languages className="h-3 w-3" />
                            Bilingual Letter Engine
                        </div>
                        <h1 className="text-4xl md:text-6xl font-black tracking-tighter text-white mb-4 leading-none italic uppercase">
                            Letter<br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">Management</span>
                        </h1>
                        <p className="text-slate-400 text-base font-medium max-w-lg leading-relaxed">
                            Generate official, government-compliant UAE documents in English and Arabic. 
                            Automated workflows for Salary Certificates, NOCs, and more.
                        </p>
                    </div>

                    <div className="flex gap-4">
                        <Button 
                            variant="outline" 
                            className="h-14 px-8 rounded-2xl bg-white/5 border-white/10 text-white hover:bg-white/10 font-black uppercase text-xs tracking-widest gap-2"
                            onClick={() => setSelectedTemplate(null)}
                        >
                            Request Archive
                        </Button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                {/* Left side: Template Selection & Generation */}
                <div className="lg:col-span-8 space-y-10">
                    {!selectedTemplate ? (
                        templates.length === 0 ? (
                            <Card className="border-none bg-white dark:bg-slate-950 shadow-lg rounded-[2.5rem] p-20 flex flex-col items-center justify-center text-center">
                                <div className="h-20 w-20 rounded-3xl bg-slate-50 dark:bg-slate-900 flex items-center justify-center mb-6">
                                    <AlertCircle className="h-10 w-10 text-slate-300" />
                                </div>
                                <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight italic mb-2">No Templates Configured</h3>
                                <p className="text-slate-400 text-sm font-medium max-w-xs">
                                    The bilingual document engine is active, but no templates have been published yet.
                                </p>
                                <Button className="mt-8 rounded-xl font-black uppercase text-xs tracking-widest bg-indigo-600 hover:bg-indigo-700 h-12 px-8" onClick={fetchData}>
                                    Retry Connection
                                </Button>
                            </Card>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {templates.map(template => (
                                    <Card key={template.id} className="group hover:scale-[1.02] transition-all duration-300 border-none bg-white dark:bg-slate-950 shadow-lg rounded-[2.5rem] overflow-hidden cursor-pointer" onClick={() => setSelectedTemplate(template)}>
                                        <CardHeader className="p-8 pb-4">
                                            <div className="h-12 w-12 rounded-2xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center text-indigo-600 mb-6 group-hover:bg-indigo-600 group-hover:text-white transition-all duration-300">
                                                <FileText className="h-6 w-6" />
                                            </div>
                                            <CardTitle className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight italic">
                                                {template.name}
                                            </CardTitle>
                                            <CardDescription className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
                                                {template.type.replace('_', ' ')}
                                            </CardDescription>
                                        </CardHeader>
                                        <CardFooter className="p-8 pt-0 flex justify-between items-center">
                                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">Ready for Preview</span>
                                            <ArrowRight className="h-5 w-5 text-slate-200 group-hover:text-indigo-600 group-hover:translate-x-2 transition-all" />
                                        </CardFooter>
                                    </Card>
                                ))}
                            </div>
                        )
                    ) : (
                        <Card className="border-none bg-white dark:bg-slate-950 shadow-2xl rounded-[3rem] overflow-hidden animate-in slide-in-from-bottom-10 duration-500">
                            <CardHeader className="p-10 bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-800">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <Button variant="ghost" size="icon" onClick={() => setSelectedTemplate(null)} className="h-10 w-10 rounded-xl hover:bg-white">
                                            <ArrowRight className="h-5 w-5 rotate-180" />
                                        </Button>
                                        <div>
                                            <CardTitle className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight italic">{selectedTemplate.name}</CardTitle>
                                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mt-1">Document Configuration</p>
                                        </div>
                                    </div>
                                    <Badge variant="outline" className="px-4 py-1.5 rounded-xl border-indigo-200 text-indigo-600 bg-indigo-50 font-black uppercase text-[10px] tracking-widest">
                                        Active Template
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent className="p-10 space-y-10">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                    {isAdmin && (
                                        <div className="space-y-3">
                                            <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Assign to Employee</Label>
                                            <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                                                <SelectTrigger className="h-14 rounded-2xl bg-slate-50 dark:bg-slate-900 border-slate-100 dark:border-slate-800 font-bold">
                                                    <SelectValue placeholder="Select target workforce member" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {employees.map(emp => (
                                                        <SelectItem key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName} - {emp.designation}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}
                                    <div className="space-y-3">
                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Purpose / Details</Label>
                                        <Input 
                                            placeholder="e.g. Bank Loan Application" 
                                            className="h-14 rounded-2xl bg-slate-50 dark:bg-slate-900 border-slate-100 dark:border-slate-800 font-bold"
                                            value={purpose}
                                            onChange={(e) => setPurpose(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-6">
                                    <h4 className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1 flex items-center gap-2">
                                        <Eye className="h-3 w-3" />
                                        Template Live Preview
                                    </h4>
                                    <Tabs defaultValue="en" className="w-full">
                                        <TabsList className="bg-slate-100 dark:bg-slate-900 p-1 rounded-xl mb-6">
                                            <TabsTrigger value="en" className="rounded-lg font-bold text-[10px] uppercase tracking-widest">English Standard</TabsTrigger>
                                            <TabsTrigger value="ar" className="rounded-lg font-bold text-[10px] uppercase tracking-widest">Arabic Translation</TabsTrigger>
                                        </TabsList>
                                        <TabsContent value="en" className="p-8 bg-slate-50 dark:bg-slate-900/50 rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-800 font-serif text-sm leading-relaxed whitespace-pre-wrap">
                                            {selectedTemplate.content_en}
                                        </TabsContent>
                                        <TabsContent value="ar" className="p-8 bg-slate-50 dark:bg-slate-900/50 rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-800 font-serif text-sm leading-relaxed text-right dir-rtl whitespace-pre-wrap">
                                            {selectedTemplate.content_ar || "No Arabic translation available for this template."}
                                        </TabsContent>
                                    </Tabs>
                                </div>
                            </CardContent>
                            <CardFooter className="p-10 bg-slate-50/50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                                        <Stamp className="h-5 w-5" />
                                    </div>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase leading-tight">
                                        Official Company Stamp & Signatory<br />
                                        <span className="text-slate-500">will be automatically appended.</span>
                                    </p>
                                </div>
                                <Button 
                                    className="h-14 px-10 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase text-xs tracking-widest shadow-xl shadow-indigo-600/20 gap-2"
                                    onClick={handleGenerate}
                                    disabled={generating}
                                >
                                    {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                    {isAdmin ? 'Generate Official Document' : 'Submit Letter Request'}
                                </Button>
                            </CardFooter>
                        </Card>
                    )}
                </div>

                {/* Right side: Activity & Archive */}
                <div className="lg:col-span-4 space-y-10">
                    <Card className="border-none bg-white dark:bg-slate-950 shadow-xl rounded-[2.5rem] overflow-hidden flex flex-col h-full max-h-[800px]">
                        <CardHeader className="p-8 border-b border-slate-100 dark:border-slate-800">
                            <CardTitle className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight italic">Document Archive</CardTitle>
                            <CardDescription className="text-[10px] font-black uppercase tracking-widest text-slate-400">Request history & status</CardDescription>
                        </CardHeader>
                        <ScrollArea className="flex-1 p-0">
                            {letters.length === 0 ? (
                                <div className="p-12 text-center text-slate-400">
                                    <Clock className="h-10 w-10 mx-auto mb-4 opacity-20" />
                                    <p className="text-xs font-bold uppercase tracking-widest">No letters generated yet</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-slate-50 dark:divide-slate-900">
                                    {letters.map(letter => (
                                        <div key={letter.id} className="p-6 hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-all cursor-pointer group" onClick={() => setViewingLetter(letter)}>
                                            <div className="flex justify-between items-start mb-3">
                                                <div className="flex flex-col">
                                                    <span className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-tight group-hover:text-indigo-600 transition-colors">
                                                        {letter.template.name}
                                                    </span>
                                                    <span className="text-[9px] font-bold text-slate-400 mt-0.5">{letter.referenceNumber}</span>
                                                </div>
                                                {getStatusBadge(letter.status)}
                                            </div>
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex min-w-0 items-center gap-2">
                                                    <div className="h-6 w-6 shrink-0 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] font-black">
                                                        {getLetterEmployeeInitials(letter.employee)}
                                                    </div>
                                                    <span className="min-w-0 truncate text-[10px] font-bold text-slate-500">
                                                        {getLetterEmployeeDisplayName(letter.employee)}
                                                    </span>
                                                </div>
                                                <span className="shrink-0 text-[9px] font-medium text-slate-300">
                                                    {new Date(letter.createdAt).toLocaleDateString()}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </ScrollArea>
                    </Card>

                    <div className="bg-indigo-600 rounded-[2.5rem] p-8 text-white shadow-2xl shadow-indigo-500/20 overflow-hidden relative group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -mr-16 -mt-16 group-hover:scale-150 transition-transform duration-700"></div>
                        <div className="flex items-center gap-4 relative z-10">
                            <div className="h-12 w-12 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center">
                                <Building2 className="h-6 w-6" />
                            </div>
                            <div>
                                <h4 className="font-black text-sm uppercase tracking-widest leading-none">Corporate Info</h4>
                                <p className="text-[10px] text-indigo-100 mt-1">Managed by Al Barakah Group HR</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Letter Viewer Modal (Full Preview) */}
            {viewingLetter && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-10 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-300">
                    <Card className="w-full max-w-5xl h-full max-h-[90vh] border-none bg-white shadow-2xl rounded-[3rem] overflow-hidden flex flex-col">
                        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <div className="flex items-center gap-4">
                                <div className="h-10 w-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white">
                                    <FileText className="h-5 w-5" />
                                </div>
                                <div>
                                    <h3 className="font-black text-slate-900 uppercase tracking-tight leading-none italic">{viewingLetter.template.name}</h3>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-1">{viewingLetter.referenceNumber}</p>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <Button 
                                    variant="outline" 
                                    className="h-11 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2 bg-indigo-50 border-indigo-100 text-indigo-600 hover:bg-indigo-600 hover:text-white transition-all" 
                                    onClick={() => generateLetterPDF(viewingLetter)}
                                >
                                    <DownloadIcon className="h-4 w-4" />
                                    Download PDF
                                </Button>
                                <Button variant="outline" className="h-11 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2" onClick={() => window.print()}>
                                    <Printer className="h-4 w-4" />
                                    Print Document
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => setViewingLetter(null)} className="h-11 w-11 rounded-xl">
                                    <Plus className="h-5 w-5 rotate-45" />
                                </Button>
                            </div>
                        </div>
                        <ScrollArea className="flex-1 p-10 md:p-20 bg-slate-50/20">
                            {/* A4 Document Content */}
                            <div className="mx-auto bg-white shadow-sm border border-slate-100 p-12 md:p-20 min-h-[1000px] w-full max-w-[800px] relative">
                                {/* Header / Letterhead */}
                                <div className="flex justify-between items-start mb-20 border-b-4 border-indigo-600 pb-8">
                                    <div>
                                        <h2 className="text-3xl font-black tracking-tighter text-slate-900 uppercase italic leading-none">Al Barakah</h2>
                                        <span className="text-[10px] font-black tracking-[0.3em] text-indigo-600 uppercase block mt-1">Group of Companies</span>
                                        <div className="mt-4 text-[9px] font-bold text-slate-400 leading-tight uppercase tracking-widest">
                                            Industrial City, Abu Dhabi, UAE<br />
                                            T: +971 2 XXX XXXX | E: info@albarakah.ae<br />
                                            Trade License: TL-100234
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="h-16 w-16 bg-slate-900 rounded-2xl flex items-center justify-center text-white font-black text-2xl ml-auto">
                                            AB
                                        </div>
                                    </div>
                                </div>

                                {/* Bilingual Layout */}
                                <div className="space-y-16">
                                    <div className="flex flex-col md:flex-row gap-10">
                                        <div className="flex-1 font-serif text-sm leading-relaxed text-slate-800 whitespace-pre-wrap">
                                            {viewingLetter.content_en}
                                        </div>
                                        {viewingLetter.content_ar && (
                                            <div className="flex-1 font-serif text-sm leading-relaxed text-slate-800 text-right dir-rtl whitespace-pre-wrap">
                                                {viewingLetter.content_ar}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Footer / Signature Area */}
                                <div className="mt-32 flex justify-between items-end">
                                    <div className="space-y-4">
                                        <div className="relative h-32 w-48">
                                            {/* Digital Signature */}
                                            <img 
                                                src="/assets/signature.png" 
                                                alt="Digital Signature" 
                                                className="absolute bottom-0 left-0 h-24 object-contain mix-blend-multiply opacity-90 -rotate-3"
                                            />
                                            {/* Digital Stamp */}
                                            <img 
                                                src="/assets/stamp.png" 
                                                alt="Corporate Stamp" 
                                                className="absolute -top-4 -right-12 h-32 w-32 object-contain mix-blend-multiply opacity-80 rotate-12"
                                            />
                                            <div className="absolute -bottom-2 -left-2 text-[7px] font-black text-indigo-600/40 uppercase tracking-[0.4em] rotate-1">
                                                ID: {viewingLetter.id.slice(0, 8).toUpperCase()} - VERIFIED
                                            </div>
                                        </div>
                                        <p className="text-[10px] font-black text-slate-900 uppercase tracking-widest border-t border-slate-200 pt-2 w-fit">Manager / Authorized Signatory</p>
                                    </div>
                                    <div className="text-right">
                                        <div className="h-20 w-20 bg-slate-100 rounded-xl flex items-center justify-center ml-auto mb-2 opacity-50">
                                            <Badge variant="outline" className="border-slate-300 text-slate-400 font-bold uppercase text-[8px]">QR Code</Badge>
                                        </div>
                                        <p className="text-[8px] font-bold text-slate-400 uppercase tracking-[0.2em]">Scan to verify authenticity</p>
                                    </div>
                                </div>
                            </div>
                        </ScrollArea>
                        <div className="p-8 border-t border-slate-100 bg-slate-50/50 flex justify-between items-center">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">
                                This is a computer generated document and does not require a physical signature.
                            </p>
                            <Button className="h-12 px-8 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black uppercase text-[10px] tracking-widest shadow-xl">
                                Send via Email
                            </Button>
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
}
