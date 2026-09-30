"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { createLoan } from "@/app/lib/actions/loans";
import { toast } from "sonner";

export function NewLoanForm({ employees }: { employees: any[] }) {
    const [open, setOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsLoading(true);
        const toastId = toast.loading("Creating loan record...");
        
        try {
            const formData = new FormData(e.currentTarget);
            const result = await createLoan(formData);
            
            if (result.success) {
                toast.success(result.message, { id: toastId });
                setOpen(false);
            } else {
                toast.error(result.message, { id: toastId });
            }
        } catch (error) {
            toast.error("Failed to create loan", { id: toastId });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-full">
                    <PlusCircle className="mr-2 h-4 w-4" /> Issue Loan
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] p-4 sm:p-6">
                <DialogHeader>
                    <DialogTitle>Issue New Loan</DialogTitle>
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
                        <Label htmlFor="amount">Loan Amount (AED)</Label>
                        <Input type="number" id="amount" name="amount" min="1" required />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="issueDate">Issue Date</Label>
                        <Input type="date" id="issueDate" name="issueDate" required defaultValue={new Date().toISOString().split('T')[0]} />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="installmentAmount">Monthly Installment (AED)</Label>
                        <Input type="number" id="installmentAmount" name="installmentAmount" min="1" required />
                    </div>

                    <div className="pt-4 flex justify-end">
                        <Button type="submit" disabled={isLoading} className="bg-indigo-600 hover:bg-indigo-700 text-white w-full">
                            {isLoading ? "Creating..." : "Issue Loan"}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
