"use client";

import { useState, useEffect } from "react";
import { upsertSalaryStructure } from "@/app/lib/actions/payroll";
import { getActiveEmployees } from "@/app/lib/actions/employees";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

type Employee = {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    designation: string;
    isActive: boolean;
};

type SalaryStructure = {
    basic: number;
    hra: number;
    allowances: number;
    deductions: number;
};

export default function SalaryStructurePage() {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [selectedEmpId, setSelectedEmpId] = useState<string>("");
    const [ctc, setCtc] = useState<number>(0);
    const [structure, setStructure] = useState<Partial<SalaryStructure>>({
        basic: 0,
        hra: 0,
        allowances: 0,
        deductions: 0,
    });

    // Fetch employees from database
    useEffect(() => {
        const fetchEmployees = async () => {
            const res = await getActiveEmployees();
            if (res.success) {
                setEmployees(res.data as Employee[]);
            } else {
                toast.error("Failed to load employees");
            }
        };
        fetchEmployees();
    }, []);

    const calculateStructure = (totalCtc: number) => {
        // Automated Calculation Logic
        // Basic = 50% of CTC
        // HRA = 50% of Basic
        // Deductions = 10% of Basic (PF/Tax Mock)
        // Allowances = Remainder

        const basic = totalCtc * 0.5;
        const hra = basic * 0.5;
        const deductions = basic * 0.1;
        const allowances = totalCtc - basic - hra; // Remaining to balance CTC? Or just fixed.
        // Let's make allowances the balancing figure or fixed. 
        // CTC = Basic + HRA + Allowances (Gross) - Employer Deductions? 
        // Let's keep it simple: CTC = Basic + HRA + Allowances. Deductions are subtracted from Gross for Net.
        // Wait, CTC usually includes Employer PF. 
        // Let's map: CTC = Gross (Basic+HRA+Allowances). Deductions are separate user input or calculated from Gross.

        // Revised Logic:
        // Basic = 50% of CTC
        // HRA = 25% of CTC
        // Allowances = 25% of CTC
        // Deductions = 12% of Basic (PF)

        const calculatedBasic = Math.round(totalCtc * 0.5);
        const calculatedHra = Math.round(totalCtc * 0.25);
        const calculatedAllowances = Math.round(totalCtc * 0.25);
        const calculatedDeductions = Math.round(calculatedBasic * 0.12); // Example PF

        setStructure({
            basic: calculatedBasic,
            hra: calculatedHra,
            allowances: calculatedAllowances,
            deductions: calculatedDeductions,
        });
    };

    const handleCtcChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseFloat(e.target.value) || 0;
        setCtc(val);
        calculateStructure(val);
    };

    return (
        <div className="p-8 max-w-4xl mx-auto space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">Salary Structure Configuration</h1>

            <Card>
                <CardHeader>
                    <CardTitle>Select Employee</CardTitle>
                </CardHeader>
                <CardContent>
                    <select
                        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        value={selectedEmpId}
                        onChange={(e) => setSelectedEmpId(e.target.value)}
                    >
                        <option value="">Select an employee...</option>
                        {employees.map(emp => (
                            <option key={emp.id} value={emp.id}>
                                {emp.firstName} {emp.lastName} - {emp.designation}
                            </option>
                        ))}
                    </select>
                </CardContent>
            </Card>

            {selectedEmpId && (
                <Card className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <CardHeader>
                        <CardTitle>Define Structure</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="ctc">Annual CTC</Label>
                                <Input
                                    id="ctc"
                                    type="number"
                                    placeholder="Enter CTC"
                                    value={ctc}
                                    onChange={handleCtcChange}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="basic">Basic Salary (50%)</Label>
                                <Input id="basic" type="number" value={structure.basic} readOnly className="bg-muted" />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="hra">HRA (25%)</Label>
                                <Input id="hra" type="number" value={structure.hra} readOnly className="bg-muted" />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="allowances">Special Allowances (25%)</Label>
                                <Input id="allowances" type="number" value={structure.allowances} readOnly className="bg-muted" />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="deductions">Estimated Deductions (PF/Tax)</Label>
                                <Input id="deductions" type="number" value={structure.deductions} readOnly className="bg-muted" />
                            </div>
                        </div>

                        <div className="pt-4 flex justify-end">
                            <Button
                                size="lg"
                                className="bg-indigo-600 hover:bg-indigo-700 px-8 rounded-xl font-bold"
                                onClick={async () => {
                                    const formData = new FormData();
                                    formData.append("employeeId", selectedEmpId);
                                    formData.append("ctc", ctc.toString());
                                    formData.append("basic", (structure.basic || 0).toString());
                                    formData.append("hra", (structure.hra || 0).toString());
                                    formData.append("allowances", (structure.allowances || 0).toString());
                                    formData.append("deductions", (structure.deductions || 0).toString());

                                    const tid = toast.loading("Saving salary structure...");
                                    const res = await upsertSalaryStructure(formData);
                                    if (res.success) toast.success(res.message, { id: tid });
                                    else toast.error(res.message, { id: tid });
                                }}
                            >
                                Save Structure Configuration
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
