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
import { Card, CardContent } from "@/components/ui/card";
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
    ChevronRight
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { upsertEmployee, deleteEmployee } from "@/app/lib/actions/employees";
import { uploadMasterFile } from "@/app/lib/actions/bulk-upload";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function EmployeeList({ initialEmployees, managers }: { initialEmployees: any[], managers: any[] }) {
    const [employees, setEmployees] = useState(initialEmployees);
    const [search, setSearch] = useState("");
    const [open, setOpen] = useState(false);
    const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
    const [filterStatus, setFilterStatus] = useState<"ALL" | "ACTIVE" | "RESIGNED">("ALL");

    const filteredEmployees = employees.filter(emp => {
        const matchesSearch = `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
            emp.email.toLowerCase().includes(search.toLowerCase()) ||
            emp.rollNumber.toLowerCase().includes(search.toLowerCase());
        
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
        const rows = filteredEmployees.map(emp => [
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


    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const result = await upsertEmployee(formData);

        if (result.success) {
            toast.success(result.message);
            setOpen(false);
            window.location.reload(); // Quick refresh
        } else {
            toast.error(result.message);
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
        } catch (error: any) {
            toast.error(`Upload failed: ${error.message || 'Unknown error'}`, { id: toastId });
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

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-7xl mx-auto">
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

                            <DialogContent className="max-w-4xl max-h-[90vh] p-0 overflow-hidden rounded-[2.5rem] flex flex-col border-0 shadow-2xl">
                                <form onSubmit={handleSubmit} className="flex flex-col h-full bg-white dark:bg-slate-950">
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
                                            <TabsList className="w-full justify-start bg-slate-100/50 dark:bg-slate-900/50 p-1.5 h-14 rounded-2xl border border-slate-200 dark:border-slate-800">
                                                <TabsTrigger value="personal" className="flex-1 rounded-xl data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-lg font-bold text-xs uppercase tracking-widest">Personal</TabsTrigger>
                                                <TabsTrigger value="employment" className="flex-1 rounded-xl data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-lg font-bold text-xs uppercase tracking-widest">Employment</TabsTrigger>
                                                <TabsTrigger value="finance" className="flex-1 rounded-xl data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-lg font-bold text-xs uppercase tracking-widest">Finance</TabsTrigger>
                                                <TabsTrigger value="docs" className="flex-1 rounded-xl data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:shadow-lg font-bold text-xs uppercase tracking-widest">Verification</TabsTrigger>
                                            </TabsList>
                                        </div>

                                        <ScrollArea className="flex-1 max-h-[500px] px-8 py-6">
                                            <TabsContent value="personal" forceMount className="m-0 space-y-8 data-[state=inactive]:hidden">
                                                <div className="grid grid-cols-2 gap-6">
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">First Name</Label>
                                                        <Input name="firstName" defaultValue={selectedEmployee?.firstName} required className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Last Name</Label>
                                                        <Input name="lastName" defaultValue={selectedEmployee?.lastName} required className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Personal Email</Label>
                                                        <Input name="email" type="email" defaultValue={selectedEmployee?.email} required className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Mobile Number</Label>
                                                        <Input name="phone" defaultValue={selectedEmployee?.phone} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
                                                </div>
                                            </TabsContent>

                                            <TabsContent value="employment" forceMount className="m-0 space-y-8 data-[state=inactive]:hidden">
                                                <div className="grid grid-cols-2 gap-6">
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Roll Number</Label>
                                                        <Input name="rollNumber" defaultValue={selectedEmployee?.rollNumber} required className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Designation</Label>
                                                        <Input name="designation" defaultValue={selectedEmployee?.designation} required className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Department</Label>
                                                        <Input name="department" defaultValue={selectedEmployee?.department} required className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Joining Date</Label>
                                                        <Input name="joiningDate" type="date" defaultValue={selectedEmployee?.joiningDate?.split('T')[0]} required className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
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
                                                        <Input name="iban" defaultValue={selectedEmployee?.iban} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
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
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Passport Number</Label>
                                                        <Input name="passportNumber" defaultValue={selectedEmployee?.passportNumber} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Passport Expiry</Label>
                                                        <Input name="passportExpiry" type="date" defaultValue={selectedEmployee?.passportExpiry?.split('T')[0]} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Emirates ID</Label>
                                                        <Input name="emiratesId" defaultValue={selectedEmployee?.emiratesId} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Emirates ID Expiry</Label>
                                                        <Input name="emiratesIdExpiry" type="date" defaultValue={selectedEmployee?.emiratesIdExpiry?.split('T')[0]} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Visa Number</Label>
                                                        <Input name="visaNumber" defaultValue={selectedEmployee?.visaNumber} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Visa Expiry</Label>
                                                        <Input name="visaExpiry" type="date" defaultValue={selectedEmployee?.visaExpiry?.split('T')[0]} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
                                                    <div className="space-y-3 col-span-2">
                                                        <Label className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] ml-1">Medical Insurance Expiry</Label>
                                                        <Input name="medicalInsuranceExpiry" type="date" defaultValue={selectedEmployee?.medicalInsuranceExpiry?.split('T')[0]} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
                                                </div>
                                            </TabsContent>
                                        </ScrollArea>
                                    </Tabs>

                                    <DialogFooter className="p-8 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                                        <Button type="button" variant="ghost" onClick={() => setOpen(false)} className="rounded-xl font-bold uppercase text-[10px] tracking-widest">Cancel</Button>
                                        <Button type="submit" className="h-12 px-10 rounded-xl bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-600/20 font-black uppercase text-xs tracking-widest">
                                            {selectedEmployee ? 'Commit Changes' : 'Finalize Entry'}
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

            {/* Employee Table */}
            <div className="bg-white/80 dark:bg-slate-950/80 backdrop-blur-2xl rounded-[3rem] border border-slate-100 dark:border-slate-800/60 shadow-2xl overflow-hidden">
                <Table>
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
                        {filteredEmployees.map((employee: any) => (
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
                {filteredEmployees.length === 0 && (
                    <div className="p-24 text-center">
                        <Users className="h-16 w-16 mx-auto mb-6 text-slate-200" />
                        <h3 className="text-xl font-black text-slate-800 dark:text-white uppercase tracking-tight">No records found</h3>
                        <p className="text-slate-400 font-medium max-w-xs mx-auto mt-2">We couldn't find any employees matching your current search parameters.</p>
                        <Button variant="link" onClick={() => setSearch("")} className="mt-4 text-indigo-600 font-bold uppercase text-xs tracking-widest">Clear all filters</Button>
                    </div>
                )}
            </div>
        </div>
    );
}

