"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import {
    Dialog,
    DialogContent,
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
import { PlusCircle } from "lucide-react";
import { createOvertime } from "@/app/lib/actions/overtime";
import { toast } from "sonner";

export function NewOvertimeForm({ employees }: { employees: any[] }) {
    const [open, setOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsLoading(true);
        const toastId = toast.loading("Logging overtime...");
        
        try {
            const formData = new FormData(e.currentTarget);
            const result = await createOvertime(formData);
            
            if (result.success) {
                toast.success(result.message, { id: toastId });
                setOpen(false);
            } else {
                toast.error(result.message, { id: toastId });
            }
        } catch (error) {
            toast.error("Failed to log overtime", { id: toastId });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-full">
                    <PlusCircle className="mr-2 h-4 w-4" /> Log Overtime
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] p-4 sm:p-6">
                <DialogHeader>
                    <DialogTitle>Log Employee Overtime</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 pt-4">
                    <div className="space-y-2">
                        <Label htmlFor="employeeId">Employee</Label>
                        <Select name="employeeId" required>
                            <SelectTrigger>
                                <SelectValue placeholder="Select an employee" />
                            </SelectTrigger>
                            <SelectContent>
                                {employees.map((emp) => (
                                    <SelectItem key={emp.id} value={emp.id}>
                                        {emp.firstName} {emp.lastName} ({emp.employeeCode || emp.id.substring(0,6)})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="date">Date</Label>
                        <DatePicker id="date" name="date" required aria-label="Overtime date" defaultValue={format(new Date(), "yyyy-MM-dd")} />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="hours">Total Hours</Label>
                        <Input type="number" step="0.5" id="hours" name="hours" min="0.5" required />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="ratePerHour">Rate Per Hour (AED)</Label>
                        <Input type="number" id="ratePerHour" name="ratePerHour" min="1" required />
                    </div>

                    <div className="pt-4 flex justify-end">
                        <Button type="submit" disabled={isLoading} className="bg-indigo-600 hover:bg-indigo-700 text-white w-full">
                            {isLoading ? "Saving..." : "Save Overtime"}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
