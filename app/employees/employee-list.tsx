"use client";

import { useState } from "react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Card,  } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Plus,
    Search,
    Filter,
    MoreVertical,
    Mail,
    Phone,
    MapPin,
    Calendar,
    Briefcase,
    Building2,
    ShieldCheck,
    CreditCard,
    UserCircle,
    Trash2,
    Upload,
    Zap,
    Download,
    Users,
    Activity,
    ChevronRight,
    Loader2,
    KeyRound,
    ClipboardCheck
} from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { upsertEmployee, deleteEmployee } from "@/app/lib/actions/employees";
import { uploadMasterFile } from "@/app/lib/actions/bulk-upload";
import { DatePicker } from "@/components/ui/date-picker";
import { DateField } from "@/components/ui/date-field";
import { cn } from "@/lib/utils";
import { FieldError } from "@/components/common/FieldError";
import { FormField } from "@/components/common/FormField";
import OnboardingPanel from "./onboarding-panel";
import { toast } from "sonner";

export default function EmployeeList({ initialEmployees,  }: { initialEmployees: any[], managers: any[] }) {
    const [employees, setEmployees] = useState(initialEmployees);
    const [search, setSearch] = useState("");
    const [open, setOpen] = useState(false);
    /** Onboarding panel target; null keeps the panel closed. */
    const [onboardingId, setOnboardingId] = useState<string | null>(null);
    const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
    const [filterStatus, setFilterStatus] = useState<"ALL" | "ACTIVE" | "RESIGNED">("ALL");

    const filteredEmployees = employees.filter(emp => {
        const searchLower = search.toLowerCase();
        const fullName = `${emp.firstName || ''} ${emp.lastName || ''}`.toLowerCase();
        const emailLower = (emp.email || '').toLowerCase();
        const rollLower = (emp.rollNumber || '').toLowerCase();

        const matchesSearch = fullName.includes(searchLower) ||
            emailLower.includes(searchLower) ||
            rollLower.includes(searchLower);
        
        const matchesStatus = filterStatus === "ALL" || emp.currentStatus === filterStatus;
        return matchesSearch && matchesStatus;
    });

    const exportToCSV = () => {
        const headers = [
            "First Name", "Last Name", "Email", "Roll Number", "Designation", "Department", "Joining Date", "Status",
            "Phone", "Gender", "Marital Status", "Nationality", "Government ID", "Address", "Permanent Address",
            "Emergency Contact", "Emergency Phone", "Bank Name", "Account Number", "IBAN", "IFSC Code",
            "Basic Salary", "Housing Allowance", "Transport Allowance", "Other Allowance",
            "Passport Number", "Passport Expiry", "Emirates ID", "Emirates ID Expiry", "Visa Number", "Visa Expiry",
            "Medical Insurance Expiry", "Employment Type", "Work Location", "Probation Days"
        ];
        const rows = employees.map(emp => [
            emp.firstName || "",
            emp.lastName || "",
            emp.email || "",
            emp.rollNumber || "",
            emp.designation || "",
            emp.department || "",
            emp.joiningDate ? new Date(emp.joiningDate).toLocaleDateString() : "",
            emp.currentStatus || "",
            emp.phone || "",
            emp.gender || "",
            emp.maritalStatus || "",
            emp.nationality || "",
            emp.governmentId || "",
            emp.address || "",
            emp.permanentAddress || "",
            emp.emergencyContact || "",
            emp.emergencyPhone || "",
            emp.bankName || "",
            emp.accountNumber || "",
            emp.iban || "",
            emp.ifscCode || "",
            emp.basicSalary !== undefined && emp.basicSalary !== null ? emp.basicSalary : "",
            emp.housingAllowance !== undefined && emp.housingAllowance !== null ? emp.housingAllowance : "",
            emp.transportAllowance !== undefined && emp.transportAllowance !== null ? emp.transportAllowance : "",
            emp.otherAllowance !== undefined && emp.otherAllowance !== null ? emp.otherAllowance : "",
            emp.passportNumber || "",
            emp.passportExpiry ? new Date(emp.passportExpiry).toLocaleDateString() : "",
            emp.emiratesId || "",
            emp.emiratesIdExpiry ? new Date(emp.emiratesIdExpiry).toLocaleDateString() : "",
            emp.visaNumber || "",
            emp.visaExpiry ? new Date(emp.visaExpiry).toLocaleDateString() : "",
            emp.medicalInsuranceExpiry ? new Date(emp.medicalInsuranceExpiry).toLocaleDateString() : "",
            emp.employmentType || "",
            emp.workLocation || "",
            emp.probationDays !== undefined && emp.probationDays !== null ? emp.probationDays : ""
        ]);

        const csvContent = "data:text/csv;charset=utf-8,\uFEFF"
            + [headers.join(","), ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(","))].join("\n");
        
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `employees_full_export_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success("Full employee directory exported successfully!");
    };


    // P0-16 (client half): server-side validation is authoritative, but the same
    // Zod schema runs here for immediate feedback. Entered data is NEVER
    // cleared on failure — the form is only reset on success.
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    /**
     * P1.1: the one-time activation link for a newly created account.
     *
     * The token is returned by the server exactly once and is not stored in
     * plaintext, so it cannot be shown again. It is held in component state and
     * rendered for HR to copy. It is deliberately NOT written to localStorage or
     * any log.
     */
    const [pendingActivation, setPendingActivation] = useState<{
        token: string;
        expiresAt: string;
    } | null>(null);

    // Client-side pre-check mirroring the required-field rules. This only
    // short-circuits obvious mistakes; the server still validates everything.
    const runClientCheck = (data: FormData): Record<string, string> => {
        const errors: Record<string, string> = {};
        const str = (k: string) => (data.get(k) as string | null)?.trim() ?? "";

        if (!str("firstName")) errors.firstName = "First name is required";
        if (!str("lastName")) errors.lastName = "Last name is required";
        if (!str("rollNumber")) errors.rollNumber = "Roll number is required";
        if (!str("designation")) errors.designation = "Designation is required";
        if (!str("department")) errors.department = "Department is required";
        if (!str("joiningDate")) errors.joiningDate = "Joining date is required";

        const email = str("email");
        if (!email) errors.email = "Email is required";
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = "Enter a valid email address";

        const phone = str("phone");
        if (phone && !/^(?:\+?971|0)?5\d{8}$/.test(phone)) {
            errors.phone = "Enter a valid UAE mobile number (e.g. 0501234567)";
        }

        const iban = str("iban").replace(/\s+/g, "");
        if (iban && !/^[A-Z0-9]{15,34}$/i.test(iban)) errors.iban = "Enter a valid IBAN";

        return errors;
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (isSubmitting) return;

        const form = e.currentTarget;
        const formData = new FormData(form);

        // Immediate client-side pass.
        const clientErrors = runClientCheck(formData);
        if (Object.keys(clientErrors).length > 0) {
            setFieldErrors(clientErrors);
            toast.error("Please correct the highlighted fields.");
            // Move focus to the first invalid control.
            const firstKey = Object.keys(clientErrors)[0];
            const el = form.querySelector<HTMLElement>(`[name="${firstKey}"]`);
            el?.focus();
            el?.scrollIntoView({ behavior: "smooth", block: "center" });
            return;
        }

        setFieldErrors({});
        setIsSubmitting(true);

        try {
            const result = await upsertEmployee(formData);

            if (result.success) {
                toast.success(result.message);
                setOpen(false);
                setFieldErrors({});

                // P1.1: the activation link is returned ONCE and is not
                // recoverable afterwards. Show it before reloading, otherwise
                // the token is lost and the new account can never sign in.
                if (result.activation) {
                    setPendingActivation({
                        token: result.activation.token,
                        expiresAt: result.activation.expiresAt,
                    });
                }
                if (result.activationError) {
                    toast.error(result.activationError, { duration: 12000 });
                }

                window.location.reload();
            } else {
                // Surface server field errors inline; keep every entered value.
                if (result.fieldErrors && Object.keys(result.fieldErrors).length > 0) {
                    setFieldErrors(result.fieldErrors);
                    const firstKey = Object.keys(result.fieldErrors)[0];
                    const el = form.querySelector<HTMLElement>(`[name="${firstKey}"]`);
                    el?.focus();
                    el?.scrollIntoView({ behavior: "smooth", block: "center" });
                }
                toast.error(result.message);
            }
        } catch {
            toast.error("Could not save the employee. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.name.endsWith('.csv')) {
            toast.error('Please upload a CSV file only');
            e.target.value = '';
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            toast.error('File size must be less than 5MB');
            e.target.value = '';
            return;
        }

        const formData = new FormData();
        formData.append("file", file);

        const toastId = toast.loading("Uploading master file...");
        try {
            const result = await uploadMasterFile(formData);

            if (result.success) {
                toast.success(result.message, { id: toastId });
                if (result.errors && result.errors.length > 0) {
                    toast.warning(`Some rows failed: ${result.errors.slice(0, 3).join('; ')}`, { duration: 8000 });
                }
                e.target.value = '';
                setTimeout(() => window.location.reload(), 1500);
            } else {
                toast.error(result.message, { id: toastId, duration: 8000 });
                if (result.errors && result.errors.length > 0) {
                    toast.warning(result.errors.slice(0, 5).join('\n'), { duration: 10000 });
                }
            }
        } catch (error: unknown) {
            toast.error(`Upload failed: ${(error instanceof Error ? error.message : "Unknown error") || 'Unknown error'}`, { id: toastId });
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this employee?")) return;
        const result = await deleteEmployee(id);
        if (result.success) {
            toast.success(result.message);
            window.location.reload();
        } else {
            toast.error(result.message);
        }
    };

    const activationUrl = pendingActivation
        ? `${typeof window !== "undefined" ? window.location.origin : ""}/activate/${pendingActivation.token}`
        : "";

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-7xl mx-auto">
            {/* Onboarding checklist — continues the hire after the record exists.
                Definite height so the scroll area has a resolvable context. */}
            <Dialog open={onboardingId !== null} onOpenChange={(o) => { if (!o) setOnboardingId(null); }}>
                <DialogContent className="max-w-[100vw] sm:max-w-[95vw] md:max-w-3xl h-[100dvh] sm:h-[85dvh] p-0 overflow-hidden rounded-none sm:rounded-[2rem] flex flex-col border-0 shadow-2xl">
                    {onboardingId && (
                        <OnboardingPanel employeeId={onboardingId} onClose={() => setOnboardingId(null)} />
                    )}
                </DialogContent>
            </Dialog>
            {/* P1.1: one-time activation link. Shown immediately after an
                employee is created, because the token is not recoverable. */}
            {pendingActivation && (
                <div
                    role="status"
                    className="rounded-3xl border-2 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-6 md:p-8 space-y-4"
                >
                    <div className="flex items-start gap-3">
                        <KeyRound className="h-6 w-6 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                            <h3 className="text-sm font-black uppercase tracking-widest text-amber-900 dark:text-amber-200">
                                Activation link — copy this now
                            </h3>
                            <p className="text-sm text-amber-800 dark:text-amber-300/90 mt-1">
                                The new account has no password yet. Send this link to the employee. It works
                                once and expires{" "}
                                {new Date(pendingActivation.expiresAt).toLocaleString()}.
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                        <input
                            readOnly
                            value={activationUrl}
                            aria-label="Activation link"
                            className="flex-1 h-11 px-4 rounded-xl bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 font-mono text-xs text-slate-800 dark:text-slate-200"
                            onFocus={(e) => e.currentTarget.select()}
                        />
                        <Button
                            onClick={() => {
                                navigator.clipboard
                                    ?.writeText(activationUrl)
                                    .then(() => toast.success("Link copied"))
                                    .catch(() => toast.error("Copy failed — select and copy manually"));
                            }}
                            className="h-11 rounded-xl bg-amber-600 hover:bg-amber-700 font-black uppercase text-xs tracking-widest shrink-0"
                        >
                            Copy link
                        </Button>
                    </div>

                    <p className="text-xs text-amber-700 dark:text-amber-400/80">
                        This link cannot be shown again. If it is lost, reissue a new one from the employee record.
                    </p>
                </div>
            )}

            {/* Premium Header */}
            <div className="relative group overflow-hidden bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-900 p-8 md:p-12 rounded-[2.5rem] shadow-2xl transition-all duration-500">
                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/2"></div>
                <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-violet-500/10 rounded-full blur-[80px] translate-y-1/2 -translate-x-1/2"></div>
                
                <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
                    <div>
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-indigo-200 text-xs font-bold uppercase tracking-widest mb-6">
                            <Users className="h-3 w-3 fill-indigo-400" />
                            Workforce Management
                        </div>
                        <h1 className="text-4xl md:text-6xl font-black tracking-tight text-white mb-4 leading-tight">
                            Employee<br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">Master Directory</span>
                        </h1>
                        <p className="text-slate-300 text-base font-medium max-w-xl leading-relaxed">
                            A centralized hub for the complete employee lifecycle. Manage records, documentation, and operational data with enterprise-grade precision.
                        </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
                        <Dialog open={open} onOpenChange={(val) => {
                            setOpen(val);
                            if (!val) setSelectedEmployee(null);
                        }}>
                            <DialogTrigger asChild>
                                <Button className="h-14 px-8 rounded-2xl bg-white text-indigo-900 hover:bg-indigo-50 font-black text-base shadow-xl border-0 transition-transform hover:scale-105 active:scale-95 gap-2">
                                    <Plus className="h-5 w-5" />
                                    Add New Record
                                </Button>
                            </DialogTrigger>

                            {/* P0-22: `max-w-4xl` (896px) overflowed every phone.
                                Full-screen below 480px, 95vw up to `sm`, then
                                the original 4xl. `h-[100dvh]` uses the dynamic
                                viewport so mobile browser chrome does not clip
                                the footer actions. */}
                            {/* A DEFINITE height on desktop is what makes the scroll
                            area work. With `sm:h-auto` the flex column has no
                            resolved height, so the scroll viewport collapsed to
                            a fixed 500px cap and the form was clipped with no
                            way to reach the remaining fields. 88dvh leaves room
                            for the header, tab bar and footer. */}
                        <DialogContent className="max-w-[100vw] sm:max-w-[95vw] md:max-w-5xl h-[100dvh] sm:h-[88dvh] p-0 overflow-hidden rounded-none sm:rounded-[2rem] flex flex-col border-0 shadow-2xl">
                                <form key={selectedEmployee?.id || 'new'} onSubmit={handleSubmit} className="flex flex-col h-full bg-white dark:bg-slate-950">
                                    <DialogHeader className="p-8 pb-4 bg-slate-50/50 dark:bg-slate-900/50">
                                        <div className="flex items-center gap-3 mb-2">
                                            <div className="h-10 w-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/20">
                                                <UserCircle className="h-6 w-6 text-white" />
                                            </div>
                                            <div>
                                                <DialogTitle className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
                                                    {selectedEmployee ? 'Update Profile' : 'New Master Entry'}
                                                </DialogTitle>
                                                <DialogDescription className="font-bold text-[10px] uppercase tracking-widest text-slate-400">
                                                    Official workforce documentation
                                                </DialogDescription>
                                            </div>
                                        </div>
                                    </DialogHeader>

                                    <input type="hidden" name="id" value={selectedEmployee?.id || ""} />

                                    <Tabs defaultValue="personal" className="flex-1 flex flex-col overflow-hidden">
                                        <div className="px-8 mt-4">
                                            {/* P0-22: 4 tab labels overflowed below 640px.
                                                Horizontally scrollable, and the triggers stop
                                                flexing so each keeps its full label. */}
                                            <div className="relative -mx-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                                                <TabsList className="w-max min-w-full justify-start bg-slate-100/50 dark:bg-slate-900/50 p-1.5 h-14 rounded-2xl border border-slate-200 dark:border-slate-800">
                                                <TabsTrigger value="personal" className="flex-1 min-w-[7rem] rounded-xl data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-lg font-bold text-xs uppercase tracking-widest">Personal</TabsTrigger>
                                                <TabsTrigger value="employment" className="flex-1 min-w-[8rem] rounded-xl data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-lg font-bold text-xs uppercase tracking-widest">Employment</TabsTrigger>
                                                <TabsTrigger value="finance" className="flex-1 min-w-[7rem] rounded-xl data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-lg font-bold text-xs uppercase tracking-widest">Finance</TabsTrigger>
                                                <TabsTrigger value="docs" className="flex-1 min-w-[9rem] rounded-xl data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-lg font-bold text-xs uppercase tracking-widest">Verification</TabsTrigger>
                                            </TabsList>
                                            </div>
                                        </div>

                                        {/* P0-22: `max-h-[500px]` clipped the last field on a
                                            phone. `min-h-0` is required for a flex child to
                                            scroll instead of overflowing. */}
                                        {/* Fills the remaining height of the dialog and
                                            scrolls. The 500px cap is gone — it was the
                                            reason fields below the fold were unreachable. */}
                                        <ScrollArea className="flex-1 min-h-0 px-6 sm:px-8 py-6">
                                            <ScrollBar className="w-2.5 bg-slate-200/60 dark:bg-slate-700/60" />
                                            <TabsContent value="personal" forceMount className="m-0 space-y-8 data-[state=inactive]:hidden">
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                                                    <FormField
                                                        name="firstName"
                                                        label="First Name"
                                                        required
                                                        autoComplete="given-name"
                                                        maxLength={80}
                                                        defaultValue={selectedEmployee?.firstName}
                                                        error={fieldErrors.firstName}
                                                    />
                                                    <FormField
                                                        name="lastName"
                                                        label="Last Name"
                                                        required
                                                        autoComplete="family-name"
                                                        maxLength={80}
                                                        defaultValue={selectedEmployee?.lastName}
                                                        error={fieldErrors.lastName}
                                                    />
                                                    <FormField
                                                        name="email"
                                                        label="Personal Email"
                                                        type="email"
                                                        inputMode="email"
                                                        autoComplete="email"
                                                        required
                                                        defaultValue={selectedEmployee?.email}
                                                        error={fieldErrors.email}
                                                    />
                                                    <FormField
                                                        name="phone"
                                                        label="Mobile Number"
                                                        type="tel"
                                                        inputMode="tel"
                                                        autoComplete="tel"
                                                        placeholder="0501234567"
                                                        defaultValue={selectedEmployee?.phone}
                                                        error={fieldErrors.phone}
                                                    />
                                                </div>
                                            </TabsContent>

                                            <TabsContent value="employment" forceMount className="m-0 space-y-8 data-[state=inactive]:hidden">
                                                <div className="grid grid-cols-2 gap-6">
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Roll Number</Label>
                                                        <Input name="rollNumber" id="emp-rollNumber" aria-invalid={fieldErrors.rollNumber ? "true" : undefined} aria-describedby={fieldErrors.rollNumber ? "emp-rollNumber-error" : undefined} defaultValue={selectedEmployee?.rollNumber} required className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
<FieldError id="emp-rollNumber" error={fieldErrors.rollNumber} />
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Designation</Label>
                                                        <Input name="designation" id="emp-designation" aria-invalid={fieldErrors.designation ? "true" : undefined} aria-describedby={fieldErrors.designation ? "emp-designation-error" : undefined} defaultValue={selectedEmployee?.designation} required className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
<FieldError id="emp-designation" error={fieldErrors.designation} />
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Department</Label>
                                                        <Input name="department" id="emp-department" aria-invalid={fieldErrors.department ? "true" : undefined} aria-describedby={fieldErrors.department ? "emp-department-error" : undefined} defaultValue={selectedEmployee?.department} required className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
<FieldError id="emp-department" error={fieldErrors.department} />
                                                    </div>
                                                    <DateField
                                                        name="joiningDate"
                                                        label="Joining Date"
                                                        defaultValue={selectedEmployee?.joiningDate}
                                                        required
                                                        maxDate={new Date()}
                                                        hint="Cannot be in the future"
                                                        error={fieldErrors.joiningDate}
                                                    />
                                                </div>
                                            </TabsContent>
                                            
                                            <TabsContent value="finance" forceMount className="m-0 space-y-8 data-[state=inactive]:hidden">
                                                <div className="grid grid-cols-2 gap-6">
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Basic Salary (AED)</Label>
                                                        <Input type="number" step="0.01" name="basicSalary" defaultValue={selectedEmployee?.basicSalary} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Housing Allowance (AED)</Label>
                                                        <Input type="number" step="0.01" name="housingAllowance" defaultValue={selectedEmployee?.housingAllowance} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Transport Allowance (AED)</Label>
                                                        <Input type="number" step="0.01" name="transportAllowance" defaultValue={selectedEmployee?.transportAllowance} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Other Allowance (AED)</Label>
                                                        <Input type="number" step="0.01" name="otherAllowance" defaultValue={selectedEmployee?.otherAllowance} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
                                                    <div className="space-y-3 col-span-2">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Bank Name</Label>
                                                        <Input name="bankName" defaultValue={selectedEmployee?.bankName} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Account Number</Label>
                                                        <Input name="accountNumber" defaultValue={selectedEmployee?.accountNumber} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">IBAN</Label>
                                                        <Input name="iban" id="emp-iban" aria-invalid={fieldErrors.iban ? "true" : undefined} aria-describedby={fieldErrors.iban ? "emp-iban-error" : undefined} defaultValue={selectedEmployee?.iban} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
<FieldError id="emp-iban" error={fieldErrors.iban} />
                                                    </div>
                                                </div>
                                            </TabsContent>

                                            <TabsContent value="docs" forceMount className="m-0 space-y-8 data-[state=inactive]:hidden">
                                                <div className="grid grid-cols-2 gap-6">
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Nationality</Label>
                                                        <Input name="nationality" defaultValue={selectedEmployee?.nationality} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Current Status</Label>
                                                        <Select name="currentStatus" defaultValue={selectedEmployee?.currentStatus || "ACTIVE"}>
                                                            <SelectTrigger className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="ACTIVE">Active</SelectItem>
                                                                <SelectItem value="ON_LEAVE">On Leave</SelectItem>
                                                                <SelectItem value="RESIGNED">Resigned</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    {/* Documents are grouped as a pair — number
                                                        alongside its expiry — so the relationship
                                                        is obvious at a glance and each expiry
                                                        carries its own relative status. */}
                                                    <div className="col-span-2 space-y-5">
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                            <div className="space-y-3">
                                                                <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Passport Number</Label>
                                                                <Input name="passportNumber" defaultValue={selectedEmployee?.passportNumber} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                            </div>
                                                            <DateField
                                                                name="passportExpiry"
                                                                label="Passport Expiry"
                                                                defaultValue={selectedEmployee?.passportExpiry}
                                                                expiry
                                                                minDate={new Date()}
                                                                hint="Must be a valid future date"
                                                                error={fieldErrors.passportExpiry}
                                                            />
                                                        </div>

                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                            <div className="space-y-3">
                                                                <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Emirates ID</Label>
                                                                <Input name="emiratesId" defaultValue={selectedEmployee?.emiratesId} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                            </div>
                                                            <DateField
                                                                name="emiratesIdExpiry"
                                                                label="Emirates ID Expiry"
                                                                defaultValue={selectedEmployee?.emiratesIdExpiry}
                                                                expiry
                                                                minDate={new Date()}
                                                                hint="Must be a valid future date"
                                                                error={fieldErrors.emiratesIdExpiry}
                                                            />
                                                        </div>

                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                            <div className="space-y-3">
                                                                <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Visa Number</Label>
                                                                <Input name="visaNumber" defaultValue={selectedEmployee?.visaNumber} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                            </div>
                                                            <DateField
                                                                name="visaExpiry"
                                                                label="Visa Expiry"
                                                                defaultValue={selectedEmployee?.visaExpiry}
                                                                expiry
                                                                minDate={new Date()}
                                                                hint="Must be a valid future date"
                                                                error={fieldErrors.visaExpiry}
                                                            />
                                                        </div>

                                                        <DateField
                                                            name="medicalInsuranceExpiry"
                                                            label="Medical Insurance Expiry"
                                                            defaultValue={selectedEmployee?.medicalInsuranceExpiry}
                                                            expiry
                                                            minDate={new Date()}
                                                            hint="Must be a valid future date"
                                                            error={fieldErrors.medicalInsuranceExpiry}
                                                        />
                                                    </div>
                                                </div>
                                            </TabsContent>
                                        </ScrollArea>
                                    </Tabs>

                                    <DialogFooter className="p-8 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                                        <Button type="button" variant="ghost" onClick={() => setOpen(false)} className="rounded-xl font-bold uppercase text-[10px] tracking-widest">Cancel</Button>
                                        {/* P0-16: disabled while saving, with a spinner, so a
                                            double-tap cannot create two employees. */}
                                        <Button
                                            type="submit"
                                            disabled={isSubmitting}
                                            aria-busy={isSubmitting}
                                            className="h-12 px-10 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-indigo-600/20 font-black uppercase text-xs tracking-widest"
                                        >
                                            {isSubmitting ? (
                                                <>
                                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                    Saving…
                                                </>
                                            ) : (
                                                selectedEmployee ? 'Commit Changes' : 'Finalize Entry'
                                            )}
                                        </Button>
                                    </DialogFooter>
                                </form>
                            </DialogContent>
                        </Dialog>

                        <input
                            id="master-file-upload"
                            type="file"
                            className="hidden"
                            accept=".csv"
                            onChange={handleBulkUpload}
                        />
                        <Button
                            variant="outline"
                            className="h-14 px-8 rounded-2xl bg-white/5 backdrop-blur-md border-white/20 text-white hover:bg-white/10 font-bold text-base transition-transform hover:scale-105 active:scale-95 gap-2"
                            onClick={() => document.getElementById('master-file-upload')?.click()}
                        >
                            <Upload className="h-5 w-5" />
                            Import CSV
                        </Button>
                    </div>
                </div>
            </div>

            {/* Quick Filter Bar */}
            <Card className="bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl border-white/40 dark:border-slate-800/60 shadow-lg rounded-[2rem] overflow-hidden">
                <div className="flex flex-col md:flex-row items-center gap-4 p-6">
                    <div className="relative flex-1 group">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                        <Input
                            placeholder="Search by name, email, or employee ID..."
                            className="pl-12 h-14 w-full bg-slate-50 dark:bg-slate-950/50 border-0 rounded-2xl font-medium focus-visible:ring-2 focus-visible:ring-indigo-500 shadow-inner"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                        <Button 
                            variant="outline" 
                            onClick={() => setFilterStatus(prev => prev === "ALL" ? "ACTIVE" : prev === "ACTIVE" ? "RESIGNED" : "ALL")}
                            className="h-14 px-6 rounded-2xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-black text-xs uppercase tracking-widest gap-2"
                        >
                            <Filter className="h-4 w-4" />
                            Status: {filterStatus}
                        </Button>
                        <Button 
                            variant="outline" 
                            onClick={exportToCSV}
                            className="h-14 px-6 rounded-2xl bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-black text-xs uppercase tracking-widest gap-2"
                        >
                            <Download className="h-4 w-4" />
                            Export
                        </Button>
                </div>
            </Card>

            {/* Employee Table / Cards (P0-22) */}
            {/* Below 768px a card list is used instead of the table. A 6-column
                table with a min-width cannot be made usable by shrinking
                columns: the content truncates and the action buttons collide.
                The two layouts are rendered from the same filtered set, so
                search, filter and empty state behave identically. */}
            <div className="bg-white/80 dark:bg-slate-950/80 backdrop-blur-2xl rounded-[3rem] border border-slate-100 dark:border-slate-800/60 shadow-2xl overflow-hidden">

                {/* ── MOBILE: card list ─────────────────────────────────── */}
                <ul className="md:hidden divide-y divide-slate-100 dark:divide-slate-900">
                    {filteredEmployees.map((employee) => (
                        <li key={employee.id} className="p-4 flex flex-col gap-3">
                            <div className="flex items-start gap-3">
                                <Avatar className="h-12 w-12 shrink-0 border-2 border-white dark:border-slate-800 shadow-lg">
                                    <AvatarImage src={employee.photo} alt="" />
                                    <AvatarFallback className="bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-600 text-white font-black">
                                        {employee.firstName?.[0]}{employee.lastName?.[0]}
                                    </AvatarFallback>
                                </Avatar>

                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-black text-slate-900 dark:text-white truncate">
                                        {employee.firstName} {employee.lastName}
                                    </p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                        {employee.designation}
                                    </p>
                                    <span className="inline-block mt-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-50 dark:bg-slate-900">
                                        {employee.rollNumber}
                                    </span>
                                </div>

                                <Badge className={cn(
                                    "shrink-0 rounded-lg px-2 py-0.5 text-[9px] font-black uppercase tracking-wider border-0",
                                    employee.currentStatus === 'ACTIVE' ? "bg-emerald-500 text-white" :
                                        employee.currentStatus === 'RESIGNED' ? "bg-amber-500 text-white" :
                                            "bg-rose-500 text-white"
                                )}>
                                    {employee.currentStatus}
                                </Badge>
                            </div>

                            <div className="flex items-center justify-between gap-2 pl-[60px]">
                                <div className="min-w-0 text-[11px] text-slate-500 space-y-0.5">
                                    <p className="truncate flex items-center gap-1.5">
                                        <Building2 className="h-3 w-3 shrink-0" />
                                        {employee.department}
                                    </p>
                                    <p className="truncate">
                                        Joined {new Date(employee.joiningDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                    </p>
                                </div>

                                {/* 44px targets: meets the minimum touch size. */}
                                <div className="flex items-center gap-2 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => setOnboardingId(employee.id)}
                                        aria-label={`Onboarding checklist for ${employee.firstName} ${employee.lastName}`}
                                        title="Onboarding checklist"
                                        className="h-11 w-11 inline-flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-600 hover:text-white transition-colors"
                                    >
                                        <ClipboardCheck className="h-5 w-5" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setSelectedEmployee(employee); setOpen(true); }}
                                        aria-label={`Edit ${employee.firstName} ${employee.lastName}`}
                                        className="h-11 w-11 inline-flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-indigo-600 hover:text-white transition-colors"
                                    >
                                        <UserCircle className="h-5 w-5" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleDelete(employee.id)}
                                        aria-label={`Delete ${employee.firstName} ${employee.lastName}`}
                                        className="h-11 w-11 inline-flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-900 text-rose-600 hover:bg-rose-600 hover:text-white transition-colors"
                                    >
                                        <Trash2 className="h-5 w-5" />
                                    </button>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>

                {/* ── TABLET/DESKTOP: full table ──────────────────────── */}
                <div className="hidden md:block overflow-x-auto">
                    <Table className="min-w-[800px]">
                        <TableHeader className="bg-slate-50/50 dark:bg-slate-900/50">
                        <TableRow className="border-0">
                            <TableHead className="px-8 py-6 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Profile</TableHead>
                            <TableHead className="px-8 py-6 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Identification</TableHead>
                            <TableHead className="px-8 py-6 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Position</TableHead>
                            <TableHead className="px-8 py-6 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Compliance</TableHead>
                            <TableHead className="px-8 py-6 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Status</TableHead>
                            <TableHead className="px-8 py-6 text-right text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Control</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredEmployees.map((employee) => (
                            <TableRow key={employee.id} className="group border-b border-slate-50 dark:border-slate-900 hover:bg-indigo-50/30 dark:hover:bg-indigo-900/10 transition-colors">
                                <TableCell className="px-8 py-6">
                                    <Avatar className="h-14 w-14 border-4 border-white dark:border-slate-800 shadow-xl group-hover:scale-110 transition-transform duration-300">
                                        <AvatarImage src={employee.photo} />
                                        <AvatarFallback className="bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-600 text-white font-black text-lg">
                                            {employee.firstName[0]}{employee.lastName[0]}
                                        </AvatarFallback>
                                    </Avatar>
                                </TableCell>
                                <TableCell className="px-8 py-6">
                                    <div className="flex flex-col">
                                        <span className="text-base font-black text-slate-900 dark:text-white tracking-tight">{employee.firstName} {employee.lastName}</span>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1 px-2 py-0.5 rounded-md bg-slate-50 dark:bg-slate-900 w-fit">{employee.rollNumber}</span>
                                    </div>
                                </TableCell>
                                <TableCell className="px-8 py-6">
                                    <div className="flex flex-col gap-2">
                                        <div className="flex items-center gap-2 text-sm font-black text-slate-700 dark:text-slate-300">
                                            <div className="p-1.5 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg">
                                                <Briefcase className="h-3.5 w-3.5 text-indigo-600" />
                                            </div>
                                            {employee.designation}
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                            <Building2 className="h-3 w-3" />
                                            {employee.department}
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell className="px-8 py-6">
                                    <div className="flex flex-col gap-2 text-[10px] font-black uppercase text-slate-500 tracking-tighter">
                                        <div className="flex items-center gap-2">
                                            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                            Joined {new Date(employee.joiningDate).toLocaleDateString([], { month: 'short', year: 'numeric', day: 'numeric' })}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                                            {employee.employmentType.replace('_', ' ')}
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell className="px-8 py-6">
                                    <Badge className={cn(
                                        "rounded-xl px-4 py-1 text-[10px] font-black uppercase tracking-[0.1em] border-0 shadow-lg shadow-current/10",
                                        employee.currentStatus === 'ACTIVE' ? "bg-emerald-500 text-white" :
                                            employee.currentStatus === 'RESIGNED' ? "bg-amber-500 text-white" :
                                                "bg-rose-500 text-white"
                                    )}>
                                        {employee.currentStatus}
                                    </Badge>
                                </TableCell>
                                <TableCell className="px-8 py-6 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-10 w-10 rounded-xl bg-white dark:bg-slate-900 shadow-md hover:bg-indigo-600 hover:text-white transition-all hover:scale-110"
                                            onClick={() => {
                                                setSelectedEmployee(employee);
                                                setOpen(true);
                                            }}
                                        >
                                            <UserCircle className="h-5 w-5" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-10 w-10 rounded-xl bg-white dark:bg-slate-900 shadow-md hover:bg-rose-600 hover:text-white transition-all hover:scale-110"
                                            onClick={() => handleDelete(employee.id)}
                                        >
                                            <Trash2 className="h-5 w-5" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                </div>
                {filteredEmployees.length === 0 && (
                    <div className="p-12 md:p-24 text-center">
                        <Users className="h-16 w-16 mx-auto mb-6 text-slate-200" />
                        <h3 className="text-xl font-black text-slate-800 dark:text-white uppercase tracking-tight">No records found</h3>
                        <p className="text-slate-400 font-medium max-w-xs mx-auto mt-2 text-sm">We couldn&#39;t find any employees matching your current search parameters.</p>
                        <Button variant="link" onClick={() => setSearch("")} className="mt-4 text-indigo-600 font-bold uppercase text-xs tracking-widest">Clear all filters</Button>
                    </div>
                )}
            </div>
        </div>
    );
}

