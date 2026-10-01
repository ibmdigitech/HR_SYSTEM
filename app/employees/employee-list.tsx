"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Card,  } from "@/components/ui/card";
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
    ClipboardCheck,
    CheckCircle2,
    Sparkles
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
import { FormProgress } from "./FormProgress";
import { PageHero } from "@/components/common/PageHero";
import { EmployeeAvatar } from "./employee-avatar";
import OnboardingPanel from "./onboarding-panel";
import {
    employeeSchema,
    employeeSchemaProvisional,
    fieldErrors as toFieldErrors,
    outstandingProvisionalFields,
} from "@/app/lib/validation";
import { normalizeEmployeePhotoValue } from "@/app/lib/photo";
import { toast } from "sonner";
const EMPLOYEE_STATUS_PRESENTATION: Record<string, { label: string; className: string }> = {
    ACTIVE: { label: "Active", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300" },
    ON_LEAVE: { label: "On leave", className: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300" },
    RESIGNED: { label: "Resigned", className: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300" },
    TERMINATED: { label: "Terminated", className: "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300" },
};

function employeeStatusPresentation(status: string | null | undefined) {
    const normalized = (status ?? "").trim().toUpperCase();
    return EMPLOYEE_STATUS_PRESENTATION[normalized] ?? {
        label: normalized ? normalized.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Unknown",
        className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    };
}

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

    // P1: section progress. `activeTab` is controlled so the progress pills can
    // act as jump targets, and `progressFormData` is refreshed on every change
    // so completion is derived from the real field values.
    const [activeTab, setActiveTab] = useState("personal");
    const [progressFormData, setProgressFormData] = useState<FormData | null>(null);
    const [photoDraft, setPhotoDraft] = useState("");
    const photoPreview = normalizeEmployeePhotoValue(photoDraft) ?? "";
    // Staged entry: allow saving with identity only, completing later.
    const [saveAsProvisional, setSaveAsProvisional] = useState(false);

    useEffect(() => {
        setPhotoDraft(normalizeEmployeePhotoValue(selectedEmployee?.photo) ?? "");
    }, [selectedEmployee?.photo, open]);

    const fieldToTab: Record<string, string> = {
        firstName: "personal",
        lastName: "personal",
        photo: "personal",
        gender: "personal",
        dateOfBirth: "personal",
        nationality: "personal",
        maritalStatus: "personal",
        email: "personal",
        phone: "personal",
        address: "personal",
        emergencyContact: "personal",
        emergencyPhone: "personal",
        rollNumber: "employment",
        designation: "employment",
        department: "employment",
        joiningDate: "employment",
        basicSalary: "finance",
        housingAllowance: "finance",
        transportAllowance: "finance",
        otherAllowance: "finance",
        bankName: "finance",
        accountNumber: "finance",
        iban: "finance",
        governmentId: "docs",
        currentStatus: "docs",
        passportNumber: "docs",
        passportExpiry: "docs",
        emiratesId: "docs",
        emiratesIdExpiry: "docs",
        visaNumber: "docs",
        visaExpiry: "docs",
        medicalInsuranceExpiry: "docs",
        iloeInsuranceExpiry: "docs",
    };

    const refreshProgress = (form: HTMLFormElement | null) => {
        if (form) setProgressFormData(new FormData(form));
    };
    const [showSuccess, setShowSuccess] = useState(false);

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
    /**
     * Client-side mirror of the server rule.
     *
     * It MUST use the same schema the server will use, or a provisional save is
     * blocked here and never reaches the action — which is what happened when
     * this always applied the full schema.
     */
    const runClientCheck = (data: FormData): Record<string, string> => {
        const raw: Record<string, unknown> = {};
        for (const [key, value] of data.entries()) {
            if (typeof value === "string") raw[key] = value;
        }
        delete raw.id;
        // A DatePicker renders a hidden input whose value may be an empty
        // string; the schemas treat "" as absent, so normalise here too.
        for (const [k, v] of Object.entries(raw)) {
            if (v === "") delete raw[k];
        }

        const schema = data.get("provision") === "1" ? employeeSchemaProvisional : employeeSchema;
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
            return toFieldErrors(parsed.error);
        }
        return {};
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
            // Switch to the tab containing the first error field.
            const firstKey = Object.keys(clientErrors)[0];
            const errorTab = fieldToTab[firstKey];
            if (errorTab && errorTab !== activeTab) {
                setActiveTab(errorTab);
            }
            toast.error("Please correct the highlighted fields.");
            // Move focus to the first invalid control.
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
                setFieldErrors({});
                setShowSuccess(true);

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

                // Show success overlay briefly, then close & reload
                setTimeout(() => {
                    setShowSuccess(false);
                    setOpen(false);
                    toast.success(result.message);
                    window.location.reload();
                }, 1800);
            } else {
                // Surface server field errors inline; keep every entered value.
                if (result.fieldErrors && Object.keys(result.fieldErrors).length > 0) {
                    setFieldErrors(result.fieldErrors);
                    const firstKey = Object.keys(result.fieldErrors)[0];
                    const errorTab = fieldToTab[firstKey];
                    if (errorTab && errorTab !== activeTab) {
                        setActiveTab(errorTab);
                    }
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
        /* `app/employees/page.tsx` already supplies `p-8 max-w-7xl mx-auto`
           around this component. The root used to add a SECOND `p-4 md:p-8`
           on top of it, so on a 375px phone the list started with
           12 (layout main) + 32 (page) + 16 (here) = 60px of horizontal
           padding on EACH side — 120px of a 375px screen, or a third of it,
           gone before a single employee name. The padding is dropped here and
           the vertical rhythm is carried by `space-y` alone. */
        <div className="w-full max-w-7xl space-y-6 md:space-y-8">
            {/* Onboarding checklist — continues the hire after the record exists.
                Definite height so the scroll area has a resolvable context. */}
            <Dialog open={onboardingId !== null} onOpenChange={(o) => { if (!o) setOnboardingId(null); }}>
                <DialogContent className="w-full max-w-[100vw] sm:max-w-[95vw] md:max-w-3xl h-[100dvh] sm:h-[85dvh] max-h-none overflow-hidden overflow-y-hidden p-0 rounded-none sm:rounded-[2rem] flex flex-col border-0 shadow-2xl">
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

            {/* Compact shared hero. The previous banner used p-8 md:p-12 with a
                text-6xl heading and fixed 500px blur orbs, which pushed the
                table below the fold on a laptop and contributed to the original
                horizontal overflow. */}
            <PageHero
                eyebrow="Workforce Management"
                eyebrowIcon={Users}
                title="Employee"
                accent="Master Directory"
                description="A centralized hub for the complete employee lifecycle. Manage records, documentation, and operational data with enterprise-grade precision."
                actions={
                    <>
                        <Button
                            onClick={() => setOpen(true)}
                            className="h-11 px-6 rounded-xl bg-white text-indigo-900 hover:bg-indigo-50 font-black text-sm shadow-lg border-0 gap-2"
                        >
                            <Plus className="h-4 w-4" />
                            Add New Record
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => document.getElementById("master-file-upload")?.click()}
                            className="h-11 px-6 rounded-xl bg-white/5 backdrop-blur-md border-white/20 text-white hover:bg-white/10 font-bold text-sm gap-2"
                        >
                            <Upload className="h-4 w-4" />
                            Import CSV
                        </Button>
                    </>
                }
            />

            <input
                id="master-file-upload"
                type="file"
                className="hidden"
                accept=".csv"
                onChange={handleBulkUpload}
            />

            <Dialog open={open} onOpenChange={(val) => {
                setOpen(val);
                if (!val) {
                    setSelectedEmployee(null);
                    setSaveAsProvisional(false);
                    setActiveTab("personal");
                }
            }}>

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
                        <DialogContent className="w-full max-w-[100vw] sm:max-w-[95vw] md:max-w-5xl h-[100dvh] sm:h-[88dvh] max-h-none overflow-hidden overflow-y-hidden p-0 rounded-none sm:rounded-[2rem] flex flex-col border-0 shadow-2xl">
                                {/* ── Success Overlay ── */}
                                {showSuccess && (
                                    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/95 dark:bg-slate-950/95 backdrop-blur-sm animate-in fade-in duration-300">
                                        <div className="relative">
                                            <div className="absolute inset-0 bg-emerald-400/20 rounded-full blur-2xl animate-pulse" />
                                            <div className="relative h-24 w-24 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-2xl shadow-emerald-500/30 animate-in zoom-in duration-500">
                                                <CheckCircle2 className="h-12 w-12 text-white" />
                                            </div>
                                        </div>
                                        <div className="mt-8 text-center space-y-2">
                                            <div className="flex items-center justify-center gap-2">
                                                <Sparkles className="h-5 w-5 text-emerald-500 animate-pulse" />
                                                <h3 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
                                                    {selectedEmployee ? 'Profile Updated' : 'Entry Created'}
                                                </h3>
                                                <Sparkles className="h-5 w-5 text-emerald-500 animate-pulse" />
                                            </div>
                                            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                                                Record has been saved to the master directory.
                                            </p>
                                        </div>
                                        <div className="mt-6 h-1 w-48 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                                            <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full animate-[progress_1.8s_ease-in-out]" style={{ width: '100%' }} />
                                        </div>
                                    </div>
                                )}
                                <form
                                    key={selectedEmployee?.id || 'new'}
                                    onSubmit={handleSubmit}
                                    onChange={(ev) => refreshProgress(ev.currentTarget as HTMLFormElement)}
                                    className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white dark:bg-slate-950"
                                >
                                    <DialogHeader className="shrink-0 p-4 sm:p-5 pb-3 bg-slate-50/50 dark:bg-slate-900/50">
                                        <div className="flex items-center gap-3">
                                            <div className="h-9 w-9 shrink-0 rounded-xl bg-indigo-600 flex items-center justify-center shadow-md shadow-indigo-600/20">
                                                <UserCircle className="h-5 w-5 text-white" />
                                            </div>
                                            <div className="min-w-0">
                                                <DialogTitle className="text-lg sm:text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight truncate">
                                                    {selectedEmployee ? 'Update Profile' : 'New Master Entry'}
                                                </DialogTitle>
                                                <DialogDescription className="font-bold text-[10px] uppercase tracking-widest text-slate-400">
                                                    Official workforce documentation
                                                </DialogDescription>
                                            </div>
                                        </div>
                                    </DialogHeader>

                                    <input type="hidden" name="id" value={selectedEmployee?.id || ""} />

                                    {/* Section progress. Recomputed on every change from the
                                        live form, so it cannot drift from the fields. */}
                                    <div className="shrink-0 px-4 sm:px-6 pt-3">
                                        <FormProgress
                                            activeTab={activeTab}
                                            onTabChange={setActiveTab}
                                            formData={progressFormData}
                                        />
                                    </div>

                                    {/* The progress pills ARE the navigation, so the old
                                        tab strip below was a duplicate control
                                        wasting ~70px of the dialog. Removed.
                                        `min-h-0` is required at every level of a
                                        flex column before a scroll child can shrink;
                                        without it the form grew past the dialog and
                                        fields below the fold were unreachable. */}
                                    <Tabs
                                        value={activeTab}
                                        onValueChange={setActiveTab}
                                        className="flex min-h-0 flex-1 flex-col overflow-hidden"
                                    >

                                        {/* P0-22: `max-h-[500px]` clipped the last field on a
                                            phone. `min-h-0` is required for a flex child to
                                            scroll instead of overflowing. */}
                                        {/* Fills the remaining height of the dialog and
                                            scrolls. The 500px cap is gone — it was the
                                            reason fields below the fold were unreachable. */}
                                        <ScrollArea className="min-h-0 flex-1 px-4 sm:px-6 py-5">
                                            <ScrollBar className="w-2.5 bg-slate-200/60 dark:bg-slate-700/60" />
                                            <TabsContent value="personal" forceMount className="m-0 space-y-8 data-[state=inactive]:hidden">
                                                {/* Section: Identity */}
                                                <div>
                                                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500 mb-4 flex items-center gap-2">
                                                        <UserCircle className="h-3.5 w-3.5" />
                                                        Identity
                                                    </h4>
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
                                                        <div className="sm:col-span-2 space-y-3">
                                                            <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Profile photo</Label>
                                                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                                                                <div className="relative h-20 w-20 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                                                                    {photoPreview ? (
                                                                        <img
                                                                            src={photoPreview}
                                                                            alt="Employee preview"
                                                                            className="h-full w-full object-cover"
                                                                        />
                                                                    ) : (
                                                                        <EmployeeAvatar
                                                                            employee={selectedEmployee ?? { firstName: "N", lastName: "A" }}
                                                                            className="h-full w-full rounded-none border-0 shadow-none"
                                                                            fallbackClassName="text-xl font-black"
                                                                        />
                                                                    )}
                                                                </div>
                                                                <div className="flex-1 space-y-2">
                                                                    <Input
                                                                        name="photo"
                                                                        type="url"
                                                                        inputMode="url"
                                                                        value={photoDraft}
                                                                        onChange={(event) => setPhotoDraft(event.target.value)}
                                                                        placeholder="https://example.com/photo.jpg or /images/profile.png"
                                                                        className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold"
                                                                    />
                                                                    <p className="flex items-center gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                                                                        <Upload className="h-3.5 w-3.5 shrink-0" />
                                                                        Optional. Use a public image URL or an app-relative path.
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="space-y-3">
                                                            <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Gender</Label>
                                                            <Select name="gender" defaultValue={selectedEmployee?.gender || ""}>
                                                                <SelectTrigger className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold">
                                                                    <SelectValue placeholder="Select" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="Male">Male</SelectItem>
                                                                    <SelectItem value="Female">Female</SelectItem>
                                                                    <SelectItem value="Other">Other</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                        <DateField
                                                            name="dateOfBirth"
                                                            label="Date of Birth"
                                                            defaultValue={selectedEmployee?.dateOfBirth}
                                                            maxDate={new Date()}
                                                            hint="Cannot be in the future"
                                                        />
                                                        <FormField
                                                            name="nationality"
                                                            label="Nationality"
                                                            defaultValue={selectedEmployee?.nationality}
                                                        />
                                                        <div className="space-y-3">
                                                            <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Marital Status</Label>
                                                            <Select name="maritalStatus" defaultValue={selectedEmployee?.maritalStatus || ""}>
                                                                <SelectTrigger className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold">
                                                                    <SelectValue placeholder="Select" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="Single">Single</SelectItem>
                                                                    <SelectItem value="Married">Married</SelectItem>
                                                                    <SelectItem value="Divorced">Divorced</SelectItem>
                                                                    <SelectItem value="Widowed">Widowed</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Divider */}
                                                <div className="border-t border-slate-100 dark:border-slate-800" />

                                                {/* Section: Contact */}
                                                <div>
                                                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500 mb-4 flex items-center gap-2">
                                                        <Phone className="h-3.5 w-3.5" />
                                                        Contact Information
                                                    </h4>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
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
                                                        <div className="sm:col-span-2 space-y-3">
                                                            <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Current Address</Label>
                                                            <Input name="address" defaultValue={selectedEmployee?.address} placeholder="Building, Street, City" className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Divider */}
                                                <div className="border-t border-slate-100 dark:border-slate-800" />

                                                {/* Section: Emergency */}
                                                <div>
                                                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-500 mb-4 flex items-center gap-2">
                                                        <ShieldCheck className="h-3.5 w-3.5" />
                                                        Emergency Contact
                                                    </h4>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
                                                        <FormField
                                                            name="emergencyContact"
                                                            label="Contact Name"
                                                            defaultValue={selectedEmployee?.emergencyContact}
                                                        />
                                                        <FormField
                                                            name="emergencyPhone"
                                                            label="Contact Phone"
                                                            type="tel"
                                                            inputMode="tel"
                                                            defaultValue={selectedEmployee?.emergencyPhone}
                                                        />
                                                    </div>
                                                </div>
                                            </TabsContent>

                                            <TabsContent value="employment" forceMount className="m-0 space-y-8 data-[state=inactive]:hidden">
                                                <div className="grid grid-cols-2 gap-6">
                                                    <FormField
                                                        name="rollNumber"
                                                        label="Roll Number"
                                                        required
                                                        defaultValue={selectedEmployee?.rollNumber}
                                                        error={fieldErrors.rollNumber}
                                                    />
                                                    <FormField
                                                        name="designation"
                                                        label="Designation"
                                                        required
                                                        defaultValue={selectedEmployee?.designation}
                                                        error={fieldErrors.designation}
                                                    />
                                                    <FormField
                                                        name="department"
                                                        label="Department"
                                                        required
                                                        defaultValue={selectedEmployee?.department}
                                                        error={fieldErrors.department}
                                                    />
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
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Government ID</Label>
                                                        <Input name="governmentId" defaultValue={selectedEmployee?.governmentId} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
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

                                    <DialogFooter className="shrink-0 p-4 sm:p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                                        <Button type="button" variant="ghost" onClick={() => setOpen(false)} className="rounded-xl font-bold uppercase text-[10px] tracking-widest">Cancel</Button>

                                        {/* Staged entry. The real HR sequence is often
                                            "offer signed, employee created, visa and
                                            bank details arrive weeks later", so the full
                                            set cannot be required up front. */}
                                        {saveAsProvisional && !selectedEmployee && (
                                            <input type="hidden" name="provision" value="1" />
                                        )}
                                        {!selectedEmployee && (
                                            <label className="flex items-center gap-2 mr-1 cursor-pointer select-none">
                                                <input
                                                    type="checkbox"
                                                    checked={saveAsProvisional}
                                                    onChange={(ev) => setSaveAsProvisional(ev.target.checked)}
                                                    className="h-4 w-4 rounded accent-indigo-600"
                                                />
                                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                                                    Save as provisional
                                                </span>
                                            </label>
                                        )}
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
                                            ) : saveAsProvisional && !selectedEmployee ? (
                                                'Save Provisional'
                                            ) : selectedEmployee ? (
                                                'Commit Changes'
                                            ) : (
                                                'Finalize Entry'
                                            )}
                                        </Button>
                                    </DialogFooter>
                                </form>
                            </DialogContent>
                        </Dialog>

            {/* Quick Filter Bar */}
            {/* `rounded-2xl` + a real border instead of the previous
                `rounded-[2rem]` glass slab: the list no longer sits inside a
                giant rounded container, so a heavily rounded control group
                above it read as the top of one. Padding is `p-3` on a phone
                rather than `p-6` — at 375px the usable width inside `p-6`
                dropped to ~239px, which is below the width of the
                "Status: RESIGNED" label. */}
            <Card className="rounded-2xl border-slate-200/80 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 sm:p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                    <div className="group relative min-w-0 flex-1">
                        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 transition-colors duration-200 group-focus-within:text-indigo-500" />
                        <Input
                            placeholder="Search by name, email, or employee ID..."
                            aria-label="Search employees by name, email, or employee ID"
                            className="h-12 w-full rounded-xl border-0 bg-slate-50 pl-12 pr-4 font-medium shadow-inner focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-slate-950/50 sm:h-14"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                    <div className="grid min-w-0 shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:items-center">
                        <Button
                            variant="outline"
                            onClick={() => setFilterStatus(prev => prev === "ALL" ? "ACTIVE" : prev === "ACTIVE" ? "RESIGNED" : "ALL")}
                            className="h-12 w-full min-w-0 rounded-xl border-slate-200 bg-white font-black text-xs uppercase tracking-widest lg:h-14 lg:w-auto dark:border-slate-800 dark:bg-slate-900"
                        >
                            <Filter className="h-4 w-4 shrink-0" />
                            <span className="truncate normal-case tracking-normal">Status: {filterStatus === "ALL" ? "All" : employeeStatusPresentation(filterStatus).label}</span>
                        </Button>
                        <Button
                            variant="outline"
                            onClick={exportToCSV}
                            className="h-12 w-full min-w-0 rounded-xl border-slate-200 bg-white font-black text-xs uppercase tracking-widest lg:h-14 lg:w-auto dark:border-slate-800 dark:bg-slate-900"
                        >
                            <Download className="h-4 w-4 shrink-0" />
                            <span className="truncate">Export</span>
                        </Button>
                    </div>
                </div>
            </Card>

            <div className="hidden md:flex md:items-center md:justify-between md:gap-3 md:rounded-2xl md:border md:border-slate-200 md:bg-white md:p-3 md:shadow-sm dark:md:border-slate-800 dark:md:bg-slate-900/60">
                <div className="flex items-center gap-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1.5 dark:bg-slate-800">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        Active {employees.filter((employee) => employee.currentStatus === "ACTIVE").length}
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1.5 normal-case tracking-normal dark:bg-slate-800">
                        <span className="h-2 w-2 rounded-full bg-amber-500" />
                        Showing {filteredEmployees.length}
                    </span>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
                    Workforce overview
                </span>
            </div>

            {/* Employee Table / Cards (P0-22) */}
            {/* Below 1280px a card list is used instead of the table to preserve readable employee details beside the sidebar. A 6-column
                table with a min-width cannot be made usable by shrinking
                columns: the content truncates and the action buttons collide.
                The two layouts are rendered from the same filtered set, so
                search, filter and empty state behave identically. */}
            {/* NO SINGLE WRAPPER AROUND THE WHOLE LIST. The previous
                `bg-white/80 backdrop-blur-2xl rounded-[3rem] shadow-2xl`
                container wrapped the ENTIRE directory, so the list read as one
                enormous empty card floating on the page — the reported "not
                required outer layer". The list now sits directly on the page
                background and the grouping happens per row instead: one card
                per employee on mobile, one card around the table on desktop.
                `min-w-0` keeps this a safe flex/grid child so a wide descendant
                cannot push the page sideways. */}
            <div className="w-full min-w-0">

                {/* ── MOBILE: one card per employee ─────────────────────── */}
                <ul className="flex flex-col gap-3 xl:hidden">
                    {filteredEmployees.map((employee) => (
                        <li key={employee.id} className="min-w-0">
                            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow duration-200 hover:shadow-md focus-within:border-indigo-300 dark:border-slate-800 dark:bg-slate-900/60 dark:focus-within:border-indigo-500">
                                {/* `min-w-0` on the flex child is what makes the
                                    name truncate instead of widening the card:
                                    a flex item defaults to min-width:auto, i.e.
                                    the width of its longest word. */}
                                <div className="flex min-w-0 items-center gap-3">
                                    {/* The SAME component the table uses — one
                                        avatar implementation, one palette, two
                                        views. */}
                                    <EmployeeAvatar
                                        employee={employee}
                                        className="h-11 w-11"
                                        fallbackClassName="text-sm"
                                    />

                                    <div className="min-w-0 flex-1">
                                        <Link
                                            href={`/employees/${employee.id}`}
                                            className="block truncate text-sm font-black text-slate-900 transition-colors duration-200 hover:text-indigo-600 dark:text-white"
                                        >
                                            {employee.firstName} {employee.lastName}
                                        </Link>
                                        <p className="mt-0.5 truncate text-xs font-medium text-slate-500 dark:text-slate-400">
                                            {employee.designation}
                                        </p>
                                    </div>
                                </div>

                                {/* WRAP, do not scroll. The list is inside
                                    `<main className="overflow-x-hidden">`, so a
                                    chip row that did not wrap would be clipped,
                                    not scrollable. `max-w-full` + `min-w-0` +
                                    `truncate` cap every chip at the card's inner
                                    width, so one long department name cannot
                                    widen the card past the viewport. */}
                                <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                                    <span className="max-w-full truncate rounded-lg bg-slate-100 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                        {employee.rollNumber}
                                    </span>
                                    <span className="flex max-w-full min-w-0 items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                        <Building2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                                        <span className="truncate">{employee.department}</span>
                                    </span>
                                    <span className="flex max-w-full min-w-0 items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                        <Calendar className="h-3 w-3 shrink-0" aria-hidden="true" />
                                        <span className="truncate">
                                            {new Date(employee.joiningDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                                        </span>
                                    </span>
                                    <Badge className={cn(
                                        "shrink-0 rounded-lg border-0 px-2.5 py-1 text-xs font-semibold",
                                        employeeStatusPresentation(employee.currentStatus).className
                                    )}>
                                        {employeeStatusPresentation(employee.currentStatus).label}
                                    </Badge>
                                    {/* The table already surfaces the staged-entry
                                        state; carrying it over means the phone is
                                        not the view where a half-completed hire
                                        looks finished. */}
                                    {outstandingProvisionalFields(employee as never).length > 0 && (
                                        <span className="max-w-full truncate rounded-lg bg-amber-100 px-2 py-1 text-[10px] font-semibold normal-case tracking-normal text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                                            Incomplete · {outstandingProvisionalFields(employee as never).length} missing
                                        </span>
                                    )}
                                </div>

                                <div className="mt-3 flex min-w-0 items-center gap-2">
                                    {/* A second, larger route to the record: the
                                        name is the primary link, but a bare
                                        truncated name next to three icon
                                        buttons is a small target. */}
                                    <Link
                                        href={`/employees/${employee.id}`}
                                        className="flex min-w-0 flex-1 items-center gap-1 text-[11px] font-black uppercase tracking-widest text-indigo-600 transition-colors duration-200 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                                    >
                                        <span className="truncate">Profile</span>
                                        <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                                    </Link>

                                    {/* 44px targets: meets the minimum touch size. */}
                                    <div className="flex shrink-0 items-center gap-1.5">
                                        <button
                                            type="button"
                                            onClick={() => setOnboardingId(employee.id)}
                                            aria-label={`Onboarding checklist for ${employee.firstName} ${employee.lastName}`}
                                            title="Onboarding checklist"
                                            className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-indigo-600 transition-colors duration-200 hover:bg-indigo-600 hover:text-white dark:bg-slate-800 dark:text-indigo-400"
                                        >
                                            <ClipboardCheck className="h-5 w-5" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => { setSelectedEmployee(employee); setOpen(true); }}
                                            aria-label={`Edit ${employee.firstName} ${employee.lastName}`}
                                            title="Edit employee"
                                            className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition-colors duration-200 hover:bg-indigo-600 hover:text-white dark:bg-slate-800 dark:text-slate-300"
                                        >
                                            <UserCircle className="h-5 w-5" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(employee.id)}
                                            aria-label={`Delete ${employee.firstName} ${employee.lastName}`}
                                            title="Delete employee"
                                            className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-rose-600 transition-colors duration-200 hover:bg-rose-600 hover:text-white dark:bg-slate-800"
                                        >
                                            <Trash2 className="h-5 w-5" />
                                        </button>
                                    </div>
                                </div>
                            </article>
                        </li>
                    ))}
                </ul>

                {/* ── TABLET/DESKTOP: full table ──────────────────────── */}
                {/* The table keeps its OWN card. That is inner grouping, not
                    the removed outer layer: one surface around one component,
                    rather than a surface around the entire page's list.
                    `w-full min-w-0` is what keeps it a shrinkable block —
                    without it the table's own min-width would widen the page
                    instead of scrolling inside `Table`'s `overflow-auto`
                    wrapper (components/ui/table.tsx:9). */}
                <div className="hidden w-full min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:block dark:border-slate-800 dark:bg-slate-900/60">
                    <Table className="w-full min-w-[640px] table-fixed">
                        <colgroup>
                            <col className="w-[76px]" />
                            <col className="w-[24%]" />
                            <col className="w-[22%]" />
                            <col className="w-[18%]" />
                            <col className="w-[13%]" />
                            <col className="w-[104px]" />
                        </colgroup>
                        <TableHeader className="bg-slate-50/90 dark:bg-slate-900/70 sticky top-0 z-10 backdrop-blur-sm">
                        <TableRow className="border-0 hover:bg-transparent">
                            <TableHead className="h-12 pl-6 pr-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Profile</TableHead>
                            <TableHead className="h-12 px-4 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Employee</TableHead>
                            <TableHead className="h-12 px-4 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Position</TableHead>
                            <TableHead className="h-12 px-4 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Employment</TableHead>
                            <TableHead className="h-12 px-4 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Status</TableHead>
                            <TableHead className="h-12 pr-4 pl-2 text-right text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredEmployees.map((employee) => (
                            <TableRow key={employee.id} className="group border-b border-slate-100 dark:border-slate-800/70 transition-colors hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20">
                                <TableCell className="py-4 pl-6 pr-2">
                                    <Link
                                        href={`/employees/${employee.id}`}
                                        aria-label={`View profile for ${employee.firstName} ${employee.lastName}`}
                                        title={`View profile for ${employee.firstName} ${employee.lastName}`}
                                        className="inline-flex rounded-full outline-none transition-transform duration-200 hover:scale-105 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                                    >
                                        <EmployeeAvatar
                                            employee={employee}
                                            className="h-11 w-11"
                                            fallbackClassName="text-sm"
                                        />
                                    </Link>
                                </TableCell>
                                <TableCell className="py-4 px-4">
                                    <div className="flex min-w-0 flex-col gap-1">
                                        <Link
                                            href={`/employees/${employee.id}`}
                                            className="truncate text-sm font-black text-slate-900 transition-colors duration-200 hover:text-indigo-600 dark:text-white"
                                        >
                                            {employee.firstName} {employee.lastName}
                                        </Link>
                                        <span className="truncate font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                            {employee.rollNumber}
                                        </span>
                                        <Link
                                            href={`/employees/${employee.id}`}
                                            className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                                        >
                                            View profile
                                        </Link>
                                    </div>
                                </TableCell>
                                <TableCell className="py-4 px-4">
                                    <div className="flex min-w-0 flex-col gap-1">
                                        <span className="truncate text-sm font-bold text-slate-700 dark:text-slate-200">
                                            {employee.designation}
                                        </span>
                                        <span className="truncate text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                            {employee.department}
                                        </span>
                                    </div>
                                </TableCell>
                                <TableCell className="py-4 px-4">
                                    <div className="flex min-w-0 flex-col gap-1 text-[10px] font-semibold tracking-normal text-slate-500">
                                        <span className="flex items-center gap-1.5 truncate">
                                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                                            {new Date(employee.joiningDate).toLocaleDateString("en-GB", {
                                                day: "2-digit",
                                                month: "short",
                                                year: "numeric",
                                            })}
                                        </span>
                                        <span className="flex items-center gap-1.5 truncate">
                                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                                            {String(employee.employmentType).replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())}
                                        </span>
                                    </div>
                                </TableCell>
                                <TableCell className="py-4 px-4">
                                    <div className="flex min-w-0 flex-col gap-1.5">
                                        <Badge
                                            className={cn(
                                                "w-fit max-w-full truncate rounded-lg px-2.5 py-1 text-xs font-semibold normal-case tracking-normal border-0",
                                                outstandingProvisionalFields(employee as never).length > 0
                                                    ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                                                    : employeeStatusPresentation(employee.currentStatus).className
                                            )}
                                        >
                                            {outstandingProvisionalFields(employee as never).length > 0
                                                ? `Incomplete`
                                                : employeeStatusPresentation(employee.currentStatus).label}
                                        </Badge>
                                        {outstandingProvisionalFields(employee as never).length > 0 && (
                                            <span
                                                className="truncate text-[10px] font-bold text-amber-600 dark:text-amber-400"
                                                title={outstandingProvisionalFields(employee as never)
                                                    .map((f) => f.label)
                                                    .join(", ")}
                                            >
                                                Details required
                                            </span>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell className="py-4 pr-4 pl-2 text-right">
                                    <div className="flex items-center justify-end gap-1.5">
                                        <button
                                            type="button"
                                            aria-label={`Edit ${employee.firstName} ${employee.lastName}`}
                                            title="Edit employee"
                                            onClick={() => {
                                                setSelectedEmployee(employee);
                                                setOpen(true);
                                            }}
                                            className="h-9 w-9 inline-flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-600 hover:text-white transition-colors"
                                        >
                                            <UserCircle className="h-4 w-4" />
                                        </button>
                                        <button
                                            type="button"
                                            aria-label={`Delete ${employee.firstName} ${employee.lastName}`}
                                            title="Delete employee"
                                            onClick={() => handleDelete(employee.id)}
                                            className="h-9 w-9 inline-flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-rose-600 hover:bg-rose-600 hover:text-white transition-colors"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                </div>
                {/* The empty state sits OUTSIDE both views, exactly as before:
                    removing the outer wrapper is not a reason to drop it, and
                    it previously disappeared once during a card-view change.
                    It carries its own dashed surface now that the list no
                    longer supplies one. */}
                {filteredEmployees.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-12 text-center dark:border-slate-700 dark:bg-slate-900/40 md:p-24">
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

