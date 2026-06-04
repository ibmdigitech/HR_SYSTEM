"use client";

import { useState } from "react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Clock, FileEdit, Users, Landmark, Briefcase, FileCheck, XCircle } from "lucide-react";
import { updatePayrollStatus } from "@/app/lib/actions/payroll";
import { toast } from "sonner";

export function PayrollStatusDropdown({ record }: { record: any }) {
    const [status, setStatus] = useState(record.status);
    const [isUpdating, setIsUpdating] = useState(false);

    const handleUpdate = async (newStatus: string) => {
        if (newStatus === status) return;
        setIsUpdating(true);
        const toastId = toast.loading(`Updating status to ${newStatus}...`);
        
        try {
            const result = await updatePayrollStatus(record.id, newStatus);
            if (result.success) {
                setStatus(newStatus);
                toast.success(result.message, { id: toastId });
            } else {
                toast.error(result.message, { id: toastId });
                setStatus(status);
            }
        } catch (error) {
            toast.error("Failed to update status", { id: toastId });
            setStatus(status);
        } finally {
            setIsUpdating(false);
        }
    };

    const getStatusColor = (s: string) => {
        switch (s) {
            case "DRAFT": return "bg-slate-100 text-slate-700 border-slate-200";
            case "PENDING_HR": return "bg-blue-100 text-blue-700 border-blue-200";
            case "PENDING_FINANCE": return "bg-indigo-100 text-indigo-700 border-indigo-200";
            case "PENDING_MANAGEMENT": return "bg-purple-100 text-purple-700 border-purple-200";
            case "PROCESSED": return "bg-cyan-100 text-cyan-700 border-cyan-200";
            case "PAID": return "bg-emerald-100 text-emerald-700 border-emerald-200";
            case "CANCELLED": return "bg-rose-100 text-rose-700 border-rose-200";
            default: return "bg-amber-100 text-amber-700 border-amber-200";
        }
    };

    const getStatusIcon = (s: string) => {
        switch (s) {
            case "DRAFT": return <FileEdit className="mr-2 h-4 w-4" />;
            case "PENDING_HR": return <Users className="mr-2 h-4 w-4" />;
            case "PENDING_FINANCE": return <Landmark className="mr-2 h-4 w-4" />;
            case "PENDING_MANAGEMENT": return <Briefcase className="mr-2 h-4 w-4" />;
            case "PROCESSED": return <FileCheck className="mr-2 h-4 w-4" />;
            case "PAID": return <CheckCircle2 className="mr-2 h-4 w-4" />;
            case "CANCELLED": return <XCircle className="mr-2 h-4 w-4" />;
            default: return <Clock className="mr-2 h-4 w-4" />;
        }
    };

    return (
        <Select 
            value={status} 
            onValueChange={handleUpdate} 
            disabled={isUpdating}
        >
            <SelectTrigger 
                className={`h-7 w-auto min-w-[120px] text-xs font-bold rounded-full border px-3 ${getStatusColor(status)}`}
            >
                <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent align="end" className="rounded-xl">
                {["DRAFT", "PENDING_HR", "PENDING_FINANCE", "PENDING_MANAGEMENT", "PROCESSED", "PAID", "CANCELLED"].map(s => (
                    <SelectItem key={s} value={s} className="font-bold cursor-pointer">
                        <div className="flex items-center text-xs">
                            {getStatusIcon(s)} {s.replace('_', ' ')}
                        </div>
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
