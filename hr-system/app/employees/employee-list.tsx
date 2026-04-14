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
    Upload
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

    const filteredEmployees = employees.filter(emp =>
        `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
        emp.email.toLowerCase().includes(search.toLowerCase()) ||
        emp.rollNumber.toLowerCase().includes(search.toLowerCase())
    );

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

        // Validate file type
        if (!file.name.endsWith('.csv')) {
            toast.error('Please upload a CSV file only');
            e.target.value = '';
            return;
        }

        // Validate file size (max 5MB)
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
                // Reset file input
                e.target.value = '';
                // Refresh data
                setTimeout(() => window.location.reload(), 1500);
            } else {
                toast.error(result.message, { id: toastId, duration: 8000 });
                if (result.errors && result.errors.length > 0) {
                    console.error("Bulk upload errors:", result.errors);
                    // Show first few errors in toast
                    toast.warning(result.errors.slice(0, 5).join('\n'), { duration: 10000 });
                }
            }
        } catch (error: any) {
            console.error("Bulk upload failed:", error);
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
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Employee Master</h1>
                    <p className="text-slate-500 dark:text-slate-400">View and manage the complete employee lifecycle.</p>
                </div>

                <div className="flex items-center gap-2">
                    <div className="relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                        <Input
                            placeholder="Search name, email, roll no..."
                            className="pl-9 w-64 md:w-80 h-10 rounded-xl"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
                    <Dialog open={open} onOpenChange={(val) => {
                        setOpen(val);
                        if (!val) setSelectedEmployee(null);
                    }}>
                        <DialogTrigger asChild>
                            <Button className="h-10 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200 dark:shadow-none font-bold gap-2">
                                <Plus className="h-4 w-4" />
                                Add Record
                            </Button>
                        </DialogTrigger>

                        <DialogContent className="max-w-4xl max-h-[90vh] p-0 overflow-hidden rounded-2xl flex flex-col">
                            <form onSubmit={handleSubmit} className="flex flex-col h-full">
                                <DialogHeader className="p-6 pb-0">
                                    <DialogTitle className="text-2xl font-black text-slate-900 dark:text-white">
                                        {selectedEmployee ? 'Update Record' : 'Employee Master Entry'}
                                    </DialogTitle>
                                    <DialogDescription>
                                        Detailed employment, personal, and financial documentation.
                                    </DialogDescription>
                                </DialogHeader>

                                <input type="hidden" name="id" value={selectedEmployee?.id || ""} />

                                <Tabs defaultValue="personal" className="flex-1 flex flex-col overflow-hidden">
                                    <div className="px-6 mt-4">
                                        <TabsList className="w-full justify-start bg-slate-100/50 dark:bg-slate-900/50 p-1 h-11 rounded-xl">
                                            <TabsTrigger value="personal" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">Personal</TabsTrigger>
                                            <TabsTrigger value="employment" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">Employment</TabsTrigger>
                                            <TabsTrigger value="finance" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">Finance</TabsTrigger>
                                            <TabsTrigger value="docs" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">Verification</TabsTrigger>
                                        </TabsList>
                                    </div>

                                    <ScrollArea className="flex-1 h-[500px] p-6">
                                        <TabsContent value="personal" forceMount className="m-0 space-y-6 data-[state=inactive]:hidden">
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-bold uppercase text-slate-500">First Name</Label>
                                                    <Input name="firstName" defaultValue={selectedEmployee?.firstName} required />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-bold uppercase text-slate-500">Last Name</Label>
                                                    <Input name="lastName" defaultValue={selectedEmployee?.lastName} required />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-bold uppercase text-slate-500">Personal Email</Label>
                                                    <Input name="email" type="email" defaultValue={selectedEmployee?.email} required />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-bold uppercase text-slate-500">Mobile Number</Label>
                                                    <Input name="phone" defaultValue={selectedEmployee?.phone} />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-bold uppercase text-slate-500">Date of Birth</Label>
                                                    <Input name="dateOfBirth" type="date" defaultValue={selectedEmployee?.dateOfBirth?.split('T')[0]} />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-bold uppercase text-slate-500">Gender</Label>
                                                    <Select name="gender" defaultValue={selectedEmployee?.gender || "MALE"}>
                                                        <SelectTrigger className="rounded-lg">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="MALE">Male</SelectItem>
                                                            <SelectItem value="FEMALE">Female</SelectItem>
                                                            <SelectItem value="OTHER">Other</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-xs font-bold uppercase text-slate-500">Current Address</Label>
                                                <Input name="address" defaultValue={selectedEmployee?.address} />
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-bold uppercase text-slate-500">Emergency Contact</Label>
                                                    <Input name="emergencyContact" defaultValue={selectedEmployee?.emergencyContact} />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-bold uppercase text-slate-500">Emergency Phone</Label>
                                                    <Input name="emergencyPhone" defaultValue={selectedEmployee?.emergencyPhone} />
                                                </div>
                                            </div>
                                        </TabsContent>

                                        <TabsContent value="employment" forceMount className="m-0 space-y-6 data-[state=inactive]:hidden">
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-bold uppercase text-slate-500">Roll Number</Label>
                                                    <Input name="rollNumber" defaultValue={selectedEmployee?.rollNumber} required />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-bold uppercase text-slate-500">Joining Date</Label>
                                                    <Input name="joiningDate" type="date" defaultValue={selectedEmployee?.joiningDate?.split('T')[0]} required />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-bold uppercase text-slate-500">Designation</Label>
                                                    <Input name="designation" defaultValue={selectedEmployee?.designation} required />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-bold uppercase text-slate-500">Department</Label>
                                                    <Input name="department" defaultValue={selectedEmployee?.department} required />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-bold uppercase text-slate-500">Reporting Manager</Label>
                                                    <Select name="managerId" defaultValue={selectedEmployee?.managerId || ""}>
                                                        <SelectTrigger className="rounded-lg">
                                                            <SelectValue placeholder="Select Manager" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="none">None</SelectItem>
                                                            {managers.map(m => (
                                                                <SelectItem key={m.id} value={m.id}>{m.firstName} {m.lastName}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-bold uppercase text-slate-500">Work Location</Label>
                                                    <Input name="workLocation" defaultValue={selectedEmployee?.workLocation} placeholder="e.g. Dubai Office" />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-bold uppercase text-slate-500">Employment Type</Label>
                                                    <Select name="employmentType" defaultValue={selectedEmployee?.employmentType || "FULL_TIME"}>
                                                        <SelectTrigger className="rounded-lg">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="FULL_TIME">Full Time</SelectItem>
                                                            <SelectItem value="CONTRACT">Contract</SelectItem>
                                                            <SelectItem value="PART_TIME">Part Time</SelectItem>
                                                            <SelectItem value="INTERN">Intern</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-bold uppercase text-slate-500">Probation (Days)</Label>
                                                    <Input name="probationDays" type="number" defaultValue={selectedEmployee?.probationDays || 90} />
                                                </div>
                                            </div>
                                        </TabsContent>

                                        <TabsContent value="finance" forceMount className="m-0 space-y-6 data-[state=inactive]:hidden">
                                            <div className="grid grid-cols-1 gap-4">
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-bold uppercase text-slate-500">Bank Name</Label>
                                                    <Input name="bankName" defaultValue={selectedEmployee?.bankName} />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-bold uppercase text-slate-500">Account Number</Label>
                                                    <Input name="accountNumber" defaultValue={selectedEmployee?.accountNumber} />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-bold uppercase text-slate-500">IFSC / IBAN / SWIFT</Label>
                                                    <Input name="ifscCode" defaultValue={selectedEmployee?.ifscCode} />
                                                </div>
                                            </div>
                                        </TabsContent>

                                        <TabsContent value="docs" forceMount className="m-0 space-y-6 data-[state=inactive]:hidden">
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-bold uppercase text-slate-500">Government ID </Label>
                                                    <Input name="governmentId" defaultValue={selectedEmployee?.governmentId} placeholder="Aadhar / Passport #" />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-bold uppercase text-slate-500">Nationality</Label>
                                                    <Input name="nationality" defaultValue={selectedEmployee?.nationality} />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-bold uppercase text-slate-500">Marital Status</Label>
                                                    <Select name="maritalStatus" defaultValue={selectedEmployee?.maritalStatus || "SINGLE"}>
                                                        <SelectTrigger className="rounded-lg">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="SINGLE">Single</SelectItem>
                                                            <SelectItem value="MARRIED">Married</SelectItem>
                                                            <SelectItem value="DIVORCED">Divorced</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="text-xs font-bold uppercase text-slate-500">Current Status</Label>
                                                    <Select name="currentStatus" defaultValue={selectedEmployee?.currentStatus || "ACTIVE"}>
                                                        <SelectTrigger className="rounded-lg">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="ACTIVE">Active</SelectItem>
                                                            <SelectItem value="ON_LEAVE">On Leave</SelectItem>
                                                            <SelectItem value="RESIGNED">Resigned</SelectItem>
                                                            <SelectItem value="TERMINATED">Terminated</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>
                                        </TabsContent>
                                    </ScrollArea>
                                </Tabs>

                                <DialogFooter className="p-6 border-t border-slate-100 bg-slate-50/50 dark:bg-slate-900/50">
                                    <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                                    <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 px-8">
                                        {selectedEmployee ? 'Update Profile' : 'Save Employee'}
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
                        className="h-10 px-6 rounded-xl font-bold gap-2"
                        onClick={() => document.getElementById('master-file-upload')?.click()}
                    >
                        <Upload className="h-4 w-4" />
                        Master File
                    </Button>
                </div>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden shadow-sm">
                <Table>
                    <TableHeader className="bg-slate-50/50 dark:bg-slate-900/50">
                        <TableRow>
                            <TableHead className="w-[100px]">Profile</TableHead>
                            <TableHead>Identificaton</TableHead>
                            <TableHead>Position & Dept</TableHead>
                            <TableHead>Contact</TableHead>
                            <TableHead>Details</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredEmployees.map((employee: any) => (
                            <TableRow key={employee.id} className="group transition-colors hover:bg-slate-50/50">
                                <TableCell>
                                    <Avatar className="h-12 w-12 border-2 border-white dark:border-slate-800 shadow-sm">
                                        <AvatarImage src={employee.photo} />
                                        <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold">
                                            {employee.firstName[0]}{employee.lastName[0]}
                                        </AvatarFallback>
                                    </Avatar>
                                </TableCell>
                                <TableCell>
                                    <div className="font-bold text-slate-900 dark:text-white">{employee.firstName} {employee.lastName}</div>
                                    <div className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-tighter">{employee.rollNumber}</div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                                            <Briefcase className="h-3 w-3 text-indigo-500" />
                                            {employee.designation}
                                        </div>
                                        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                                            <Building2 className="h-3 w-3" />
                                            {employee.department}
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-col gap-1 text-[11px]">
                                        <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                                            <Mail className="h-3 w-3" />
                                            {employee.email}
                                        </div>
                                        <div className="flex items-center gap-1.5 text-slate-600">
                                            <Phone className="h-3 w-3" />
                                            {employee.phone || "No phone"}
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <div className="flex flex-col gap-1 text-[10px] uppercase font-bold text-slate-400">
                                        <div className="flex items-center gap-1">
                                            <Calendar className="h-3 w-3" />
                                            Joined {new Date(employee.joiningDate).toLocaleDateString()}
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <ShieldCheck className="h-3 w-3" />
                                            {employee.employmentType.replace('_', ' ')}
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell>
                                    <Badge className={cn(
                                        "rounded-full px-3 py-0.5 text-[10px] font-black uppercase tracking-widest border-none",
                                        employee.currentStatus === 'ACTIVE' ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30" :
                                            employee.currentStatus === 'RESIGNED' ? "bg-amber-100 text-amber-700" :
                                                "bg-red-100 text-red-700"
                                    )}>
                                        {employee.currentStatus}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-1">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 rounded-full hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                                            onClick={() => {
                                                setSelectedEmployee(employee);
                                                setOpen(true);
                                            }}
                                        >
                                            <UserCircle className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 rounded-full hover:bg-red-50 hover:text-red-600 transition-colors"
                                            onClick={() => handleDelete(employee.id)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                {filteredEmployees.length === 0 && (
                    <div className="p-12 text-center text-slate-400">
                        No employees found matching your search.
                    </div>
                )}
            </div>
        </div >
    );
}
