"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Plus, DollarSign, Calendar, FileQuestion, ArrowRightLeft, HelpCircle, Check, X,  } from "lucide-react";
import { submitStaffRequest, handleRequestAction } from "@/app/lib/actions/requests";
import { DatePicker } from "@/components/ui/date-picker";
import { toast } from "sonner";
import type { ServiceRequest, ServiceCategory, Employee } from "@/prisma/generated/client";

/**
 * A service request row exactly as the page sends it.
 *
 * The relation is `category` (ServiceRequest -> ServiceCategory). Reading
 * `serviceType` was undefined on every row and threw at runtime as soon as the
 * table had content. Typing this makes the compiler catch such a mismatch.
 */
type RequestRow = ServiceRequest & {
    employee: Employee;
    category: ServiceCategory | null;
};

export default function RequestClient({
    requests,
    serviceTypes,
    isStaffOnly,

}: {
    /**
     * Typed from the actual Prisma payload the page sends
     * (`include: { employee: true, category: true }`).
     *
     * These were `any[]`, which is why the `category` / `serviceType` mismatch
     * below was invisible to the compiler and only surfaced as a runtime crash
     * once a request existed. Typing them makes that class of bug a build error.
     */
    requests: RequestRow[];
    serviceTypes: ServiceCategory[];
    isStaffOnly: boolean;
    role: string;
}) {
    const [open, setOpen] = useState(false);
    const [selectedTypeId, setSelectedTypeId] = useState("");
    const [hrNoteOpen, setHrNoteOpen] = useState(false);
    const [activeRequest, setActiveRequest] = useState<any>(null);
    const [hrAction, setHrAction] = useState<"APPROVED" | "REJECTED" | "COMPLETED">("APPROVED");
    const [hrNote, setHrNote] = useState("");
    const [submitting, setSubmitting] = useState(false);
    // Server-returned field errors, so the user sees which field is wrong
    // instead of only a generic toast.
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

    const selectedType = serviceTypes.find(t => t.id === selectedTypeId);

    // `startDate` and `endDate` are both nullable on ServiceRequest.
    // `new Date(null)` yields a bogus 1970 date rather than failing, so the
    // null case is handled explicitly.
    const formatDate = (value: Date | string | null | undefined): string => {
        if (!value) return "—";
        const d = new Date(value);
        return isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (submitting) return;

        // A service type must be chosen before submitting; Radix Select is not
        // a native control, so the browser cannot enforce `required` for us.
        if (!selectedTypeId) {
            setFieldErrors({ categoryId: "Select a service type" });
            toast.error("Please select a service type.");
            return;
        }

        setSubmitting(true);
        setFieldErrors({});

        const form = e.currentTarget;
        const formData = new FormData(form);

        try {
            const result = await submitStaffRequest(null, formData);

            if (result.success) {
                toast.success(result.message);
                setOpen(false);
                setSelectedTypeId("");
                setFieldErrors({});
                window.location.reload();
            } else {
                if (result.fieldErrors && Object.keys(result.fieldErrors).length > 0) {
                    setFieldErrors(result.fieldErrors);
                    const first = Object.keys(result.fieldErrors)[0];
                    const el = form.querySelector<HTMLElement>(`[name="${first}"]`);
                    el?.focus();
                    el?.scrollIntoView({ behavior: "smooth", block: "center" });
                }
                toast.error(result.message);
            }
        } catch {
            toast.error("Could not submit the request. Please try again.");
        } finally {
            setSubmitting(false);
        }
    };

    const triggerAction = (request: any, action: "APPROVED" | "REJECTED" | "COMPLETED") => {
        setActiveRequest(request);
        setHrAction(action);
        setHrNote("");
        setHrNoteOpen(true);
    };

    const submitAction = async () => {
        if (!activeRequest) return;
        const result = await handleRequestAction(activeRequest.id, hrAction, hrNote);

        if (result.success) {
            toast.success(result.message);
            setHrNoteOpen(false);
            window.location.reload();
        } else {
            toast.error(result.message);
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "PENDING":
                return <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0">Pending</Badge>;
            case "APPROVED":
                return <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-0">Approved</Badge>;
            case "REJECTED":
                return <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 border-0">Rejected</Badge>;
            case "COMPLETED":
                return <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0">Completed</Badge>;
            default:
                return <Badge className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400 border-0">{status}</Badge>;
        }
    };

    return (
        <div className="space-y-8">
            {/* Header Section */}
            <div className="relative overflow-hidden bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-900 p-5 sm:p-6 md:p-12 rounded-[2.5rem] shadow-2xl transition-all">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2"></div>
                <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-purple-500/10 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/2"></div>
                
                <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 sm:gap-8">
                    <div className="min-w-0">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-indigo-200 text-xs font-bold uppercase tracking-widest mb-4 sm:mb-6">
                            <ArrowRightLeft className="h-3 w-3 text-indigo-400" />
                            Operations Request Flow
                        </div>
                        <h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-white mb-3 sm:mb-4 leading-tight">
                            Service Requests
                        </h1>
                        <p className="text-slate-300 text-base font-medium max-w-xl leading-relaxed">
                            {isStaffOnly
                                ? "Request official letters, certificates, loans, and other workplace assistance directly from human resources."
                                : "Review, moderate, and fulfill employee service certificates, loans, and verification documents."
                            }
                        </p>
                    </div>

                    <Dialog open={open} onOpenChange={setOpen}>
                        <DialogTrigger asChild>
                            <Button className="h-14 px-8 rounded-2xl bg-white text-indigo-900 hover:bg-indigo-50 font-black text-base shadow-xl border-0 transition-transform hover:scale-105 active:scale-95 gap-2">
                                <Plus className="h-5 w-5" />
                                Submit Request
                            </Button>
                        </DialogTrigger>
                        {/* `top-[50%]` centring means a dialog taller than the
                            viewport is clipped off BOTH edges with no way to
                            reach it. The form is long enough to exceed a 375x667
                            screen, so cap the height at the dynamic viewport and
                            scroll the body. `p-5 sm:p-8` keeps the 32px desktop
                            padding off a phone. */}
                        <DialogContent className="max-w-[calc(100%_-_2rem)] sm:max-w-md max-h-[calc(100dvh_-_2rem)] overflow-y-auto rounded-[1.5rem] sm:rounded-[2.5rem] border-0 shadow-2xl bg-white dark:bg-slate-950 p-5 sm:p-8">
                            <form onSubmit={handleSubmit} className="space-y-6">
                                <DialogHeader>
                                    <DialogTitle className="text-2xl font-black uppercase tracking-tight text-slate-900 dark:text-white">New Request Form</DialogTitle>
                                    <DialogDescription className="font-bold text-[10px] uppercase tracking-wider text-slate-400">Specify details for human resources processing</DialogDescription>
                                </DialogHeader>

                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Service Type</Label>
                                        {/* Field name is `categoryId`, matching
                                            ServiceRequest.categoryId. It was
                                            previously `typeId`, which the
                                            action never read — so submission
                                            always failed with "Missing required
                                            fields". */}
                                        <Select
                                            name="categoryId"
                                            required
                                            value={selectedTypeId}
                                            onValueChange={setSelectedTypeId}
                                        >
                                            <SelectTrigger className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold">
                                                <SelectValue placeholder="Select Request Type" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {serviceTypes.map(t => (
                                                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        {fieldErrors.categoryId && (
                                            <p role="alert" className="text-xs font-bold text-rose-600 dark:text-rose-400">
                                                {fieldErrors.categoryId}
                                            </p>
                                        )}
                                        {selectedType?.description && (
                                            <p className="text-[10px] text-slate-500 font-medium mt-1 bg-slate-50 dark:bg-slate-900/50 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">{selectedType.description}</p>
                                        )}
                                    </div>

                                    {/* Conditional fields based on type config */}
                                    {selectedType?.requiresAmount && (
                                        <div className="space-y-2">
                                            <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Required Amount (AED)</Label>
                                            <div className="relative">
                                                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                                <Input type="number" step="0.01" name="amount" required className="pl-9 h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                            </div>
                                        </div>
                                    )}

                                    {selectedType?.requiresDates && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Start Date</Label>
                                                <DatePicker name="startDate" required className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">End Date</Label>
                                                <DatePicker name="endDate" required className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                            </div>
                                        </div>
                                    )}

                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Purpose / Details</Label>
                                        <Textarea
                                            name="details"
                                            required
                                            maxLength={2000}
                                            aria-invalid={fieldErrors.details ? "true" : undefined}
                                            aria-describedby={fieldErrors.details ? "details-error" : undefined}
                                            rows={3}
                                            placeholder="Please explain the reason for this request..."
                                            className="rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-medium"
                                        />
                                        {fieldErrors.details && (
                                            <p id="details-error" role="alert" className="text-xs font-bold text-rose-600 dark:text-rose-400">
                                                {fieldErrors.details}
                                            </p>
                                        )}
                                    </div>

                                    {/* Optional supporting document. The action
                                        validates its size server-side. */}
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">
                                            Attachment (optional)
                                        </Label>
                                        <input
                                            type="file"
                                            name="attachment"
                                            className="block w-full text-xs text-slate-500 file:mr-3 file:rounded-xl file:border-0 file:bg-slate-100 file:px-4 file:py-2.5 file:text-xs file:font-bold file:text-slate-700 hover:file:bg-slate-200 dark:file:bg-slate-900 dark:file:text-slate-200"
                                        />
                                        <p className="text-[10px] text-slate-400">PDF or image, up to 5MB.</p>
                                    </div>
                                </div>

                                <DialogFooter>
                                    <Button type="button" variant="ghost" onClick={() => setOpen(false)} className="rounded-xl font-bold uppercase text-[10px]">Cancel</Button>
                                    <Button
                                        type="submit"
                                        disabled={submitting}
                                        aria-busy={submitting}
                                        className="h-12 px-8 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-black uppercase text-xs tracking-wider shadow-lg shadow-indigo-600/20"
                                    >
                                        {submitting ? "Submitting…" : "Submit Request"}
                                    </Button>
                                </DialogFooter>
                            </form>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {/* Requests Ledger */}
            <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800/60 shadow-sm rounded-2xl overflow-hidden">
                <CardHeader className="border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/20 px-4 py-4 sm:px-6 sm:py-5">
                    <div>
                        <CardTitle className="text-xl font-bold">Request Archive & Flow</CardTitle>
                        <CardDescription className="font-medium text-slate-500">
                            {isStaffOnly
                                ? "Overview of your personal request status history."
                                : "List of pending and processed workforce service requests."
                            }
                        </CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {/* MOBILE: card list, same six fields as the table below.
                        The empty case mirrors the table's `colSpan` row. */}
                    {requests.length === 0 ? (
                        <p className="md:hidden text-center py-20 px-4 text-slate-400 italic font-medium">
                            No requests found.
                        </p>
                    ) : (
                    <ul className="md:hidden divide-y divide-slate-100 dark:divide-slate-800/60">
                        {requests.map((record) => (
                            <li key={record.id} className="p-4 flex flex-col gap-2.5">
                                <div className="flex items-start gap-3">
                                    <div className="h-9 w-9 shrink-0 rounded-full bg-slate-100 dark:bg-slate-900 flex items-center justify-center text-slate-700 dark:text-slate-400 font-bold text-xs">
                                        {record.employee.firstName[0]}{record.employee.lastName[0]}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="font-bold text-slate-900 dark:text-white truncate">
                                            {record.employee.firstName} {record.employee.lastName}
                                        </p>
                                        <p className="text-[9px] text-slate-400 font-bold tracking-tight">
                                            {record.employee.employeeCode || record.employee.rollNumber}
                                        </p>
                                    </div>
                                    {getStatusBadge(record.status)}
                                </div>

                                <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                    {record.category?.name ?? "Unknown service"}
                                </p>
                                <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400 line-clamp-3">
                                    {record.details}
                                </p>
                                {record.hrNote && (
                                    <p className="text-[10px] italic text-indigo-600 font-bold bg-indigo-50/50 dark:bg-indigo-950/20 px-2 py-1 rounded border border-indigo-100/50 dark:border-indigo-900/50 w-fit max-w-full break-words">
                                        HR: {record.hrNote}
                                    </p>
                                )}

                                <div className="flex flex-wrap items-center gap-2 pl-12">
                                    {record.amount !== null && record.amount !== undefined && (
                                        <span className="text-xs font-black text-slate-800 dark:text-slate-200">
                                            AED {record.amount.toLocaleString()}
                                        </span>
                                    )}
                                    {record.startDate && (
                                        <span className="text-[10px] text-slate-500 font-medium">
                                            {formatDate(record.startDate)} - {formatDate(record.endDate)}
                                        </span>
                                    )}
                                </div>

                                <div className="pl-12">
                                    {!isStaffOnly && record.status === "PENDING" ? (
                                        <div className="flex items-center gap-1.5">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 hover:bg-emerald-600 hover:text-white transition-all"
                                                onClick={() => triggerAction(record, "APPROVED")}
                                            >
                                                <Check className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-rose-600 hover:bg-rose-600 hover:text-white transition-all"
                                                onClick={() => triggerAction(record, "REJECTED")}
                                            >
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ) : !isStaffOnly && record.status === "APPROVED" ? (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="font-bold border-indigo-200 text-indigo-600 hover:bg-indigo-600 hover:text-white transition-all rounded-lg text-xs"
                                            onClick={() => triggerAction(record, "COMPLETED")}
                                        >
                                            Fulfill Request
                                        </Button>
                                    ) : null}
                                </div>
                            </li>
                        ))}
                    </ul>
                    )}

                    <div className="hidden md:block overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="border-slate-100 dark:border-slate-800/60 hover:bg-transparent">
                                    <TableHead className="font-bold py-4">Employee</TableHead>
                                    <TableHead className="font-bold py-4">Request Type</TableHead>
                                    <TableHead className="font-bold py-4">Context / Details</TableHead>
                                    <TableHead className="font-bold py-4">Financials / Dates</TableHead>
                                    <TableHead className="font-bold py-4">Status</TableHead>
                                    <TableHead className="font-bold py-4 text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {requests.map((record) => (
                                    <TableRow key={record.id} className="border-slate-100 dark:border-slate-800/60 hover:bg-slate-50/80 dark:hover:bg-slate-900/50 transition-colors">
                                        <TableCell className="py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="h-9 w-9 rounded-full bg-slate-100 dark:bg-slate-900 flex items-center justify-center text-slate-700 dark:text-slate-400 font-bold text-xs">
                                                    {record.employee.firstName[0]}{record.employee.lastName[0]}
                                                </div>
                                                <div>
                                                    <div className="font-bold text-slate-900 dark:text-white">
                                                        {record.employee.firstName} {record.employee.lastName}
                                                    </div>
                                                    <div className="text-[9px] text-slate-400 font-bold tracking-tight">
                                                        {record.employee.employeeCode || record.employee.rollNumber}
                                                    </div>
                                                </div>
                                            </div>
                                        </TableCell>

                                        <TableCell className="font-bold text-slate-800 dark:text-slate-200">
                                            {/* The server includes `category`
                                                (the ServiceRequest relation), not
                                                `serviceType`. Reading `serviceType.name`
                                                was undefined for every row and threw
                                                "Cannot read properties of undefined
                                                (reading 'name')" as soon as the list was
                                                non-empty. Optional chaining keeps a
                                                missing relation from blanking the table. */}
                                            {record.category?.name ?? "Unknown service"}
                                        </TableCell>

                                        <TableCell className="max-w-xs text-xs font-medium text-slate-600 dark:text-slate-400 truncate">
                                            <div className="space-y-0.5">
                                                <div className="truncate">{record.details}</div>
                                                {record.hrNote && (
                                                    <div className="text-[10px] italic text-indigo-600 font-bold bg-indigo-50/50 dark:bg-indigo-950/20 px-2 py-0.5 rounded border border-indigo-100/50 dark:border-indigo-900/50 mt-1 w-fit max-w-full">
                                                        HR: {record.hrNote}
                                                    </div>
                                                )}
                                            </div>
                                        </TableCell>

                                        <TableCell>
                                            <div className="space-y-1 text-xs">
                                                {record.amount !== null && record.amount !== undefined && (
                                                    <div className="font-black text-slate-800 dark:text-slate-200">
                                                        AED {record.amount.toLocaleString()}
                                                    </div>
                                                )}
                                                {record.startDate && (
                                                <div className="text-[10px] text-slate-500 font-medium">
                                                    {formatDate(record.startDate)} - {formatDate(record.endDate)}
                                                </div>
                                                )}
                                                {record.amount === null && !record.startDate && (
                                                    <span className="text-slate-400 italic">--</span>
                                                )}
                                            </div>
                                        </TableCell>

                                        <TableCell>
                                            {getStatusBadge(record.status)}
                                        </TableCell>

                                        <TableCell className="text-right">
                                            {!isStaffOnly && record.status === "PENDING" ? (
                                                <div className="flex items-center justify-end gap-1.5">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 hover:bg-emerald-600 hover:text-white transition-all"
                                                        onClick={() => triggerAction(record, "APPROVED")}
                                                    >
                                                        <Check className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-rose-600 hover:bg-rose-600 hover:text-white transition-all"
                                                        onClick={() => triggerAction(record, "REJECTED")}
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ) : !isStaffOnly && record.status === "APPROVED" ? (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="font-bold border-indigo-200 text-indigo-600 hover:bg-indigo-600 hover:text-white transition-all rounded-lg text-xs"
                                                    onClick={() => triggerAction(record, "COMPLETED")}
                                                >
                                                    Fulfill Request
                                                </Button>
                                            ) : (
                                                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Processed</span>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {requests.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center py-24 text-slate-400 italic font-medium">
                                            No requests found.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            {/* Dialog for HR processing note */}
            <Dialog open={hrNoteOpen} onOpenChange={setHrNoteOpen}>
                <DialogContent className="max-w-[calc(100%_-_2rem)] sm:max-w-sm max-h-[calc(100dvh_-_2rem)] overflow-y-auto rounded-[1.5rem] sm:rounded-[2rem] border-0 shadow-2xl bg-white dark:bg-slate-950 p-5 sm:p-6">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-black uppercase tracking-tight text-slate-900 dark:text-white">
                            Process Request: {hrAction}
                        </DialogTitle>
                        <DialogDescription className="text-xs text-slate-500 font-bold">
                            Add a response note for the employee (optional)
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 my-2">
                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">HR Message / Note</Label>
                        <Textarea
                            value={hrNote}
                            onChange={(e) => setHrNote(e.target.value)}
                            placeholder="e.g. Approved. Certificate ready for collection, or Rejection reason..."
                            rows={3}
                            className="rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-medium"
                        />
                    </div>

                    <DialogFooter className="gap-2">
                        <Button variant="ghost" onClick={() => setHrNoteOpen(false)} className="rounded-xl font-bold uppercase text-[10px] h-10">Cancel</Button>
                        <Button
                            onClick={submitAction}
                            className={`h-10 px-6 rounded-xl font-black uppercase text-xs text-white shadow-lg ${
                                hrAction === "APPROVED" || hrAction === "COMPLETED"
                                    ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20"
                                    : "bg-rose-600 hover:bg-rose-700 shadow-rose-600/20"
                            }`}
                        >
                            Confirm Action
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
