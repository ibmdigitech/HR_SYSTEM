"use client";

import { useState, useEffect } from "react";
import { upsertSalaryStructure } from "@/app/lib/actions/payroll";
import { getActiveEmployees } from "@/app/lib/actions/employees";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

type Employee = {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    designation: string;
    isActive?: boolean;
};

type SalaryStructure = {
    basic: number;
    housingAllowance: number;
    transportAllowance: number;
    medicalAllowance: number;
    otherAllowances: number;
    foodAllowance: number;
    travelAllowance: number;
    commission: number;
    paymentMethod: string;
};

export default function SalaryStructurePage() {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [selectedEmpId, setSelectedEmpId] = useState<string>("");
    const [ctc, setCtc] = useState<number>(0);
    const [structure, setStructure] = useState<Partial<SalaryStructure>>({
        basic: 0,
        housingAllowance: 0,
        transportAllowance: 0,
        medicalAllowance: 0,
        foodAllowance: 0,
        travelAllowance: 0,
        commission: 0,
        otherAllowances: 0,
        paymentMethod: "BANK_TRANSFER"
    });

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
        // Advanced Auto calculation logic for UAE
        const basic = Math.round(totalCtc * 0.50);
        const housingAllowance = Math.round(totalCtc * 0.25);
        const transportAllowance = Math.round(totalCtc * 0.10);
        const medicalAllowance = Math.round(totalCtc * 0.05);
        const foodAllowance = Math.round(totalCtc * 0.05);
        const travelAllowance = Math.round(totalCtc * 0.05);
        const commission = 0;
        const otherAllowances = totalCtc - (basic + housingAllowance + transportAllowance + medicalAllowance + foodAllowance + travelAllowance);

        setStructure({
            basic,
            housingAllowance,
            transportAllowance,
            medicalAllowance,
            foodAllowance,
            travelAllowance,
            commission,
            otherAllowances,
            paymentMethod: "BANK_TRANSFER"
        });
    };

    const handleCtcChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseFloat(e.target.value) || 0;
        setCtc(val);
        calculateStructure(val);
    };

    return (
        <div className="p-8 max-w-4xl mx-auto space-y-6">
            {/* Back Button */}
            <Link href="/payroll" className="flex items-center gap-2 text-slate-500 hover:text-indigo-600 transition-colors w-fit">
                <ArrowLeft className="h-4 w-4" />
                <span className="text-sm font-medium">Back to Payroll</span>
            </Link>

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
                                <Label htmlFor="ctc">Monthly Total (AED)</Label>
                                <Input
                                    id="ctc"
                                    type="number"
                                    placeholder="Enter monthly salary"
                                    value={ctc}
                                    onChange={handleCtcChange}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="paymentMethod">Payment Method</Label>
                                <select 
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    value={structure.paymentMethod}
                                    onChange={(e) => setStructure({...structure, paymentMethod: e.target.value})}
                                >
                                    <option value="BANK_TRANSFER">Bank Transfer</option>
                                    <option value="WPS">WPS (UAE)</option>
                                    <option value="CASH">Cash</option>
                                </select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="basic">Basic Salary (50%)</Label>
                                <Input id="basic" type="number" value={structure.basic} onChange={(e) => setStructure({...structure, basic: parseFloat(e.target.value) || 0})} />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="housingAllowance">Housing Allowance (25%)</Label>
                                <Input id="housingAllowance" type="number" value={structure.housingAllowance} onChange={(e) => setStructure({...structure, housingAllowance: parseFloat(e.target.value) || 0})} />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="transportAllowance">Transport Allowance (10%)</Label>
                                <Input id="transportAllowance" type="number" value={structure.transportAllowance} onChange={(e) => setStructure({...structure, transportAllowance: parseFloat(e.target.value) || 0})} />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="medicalAllowance">Medical Allowance</Label>
                                <Input id="medicalAllowance" type="number" value={structure.medicalAllowance} onChange={(e) => setStructure({...structure, medicalAllowance: parseFloat(e.target.value) || 0})} />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="foodAllowance">Food Allowance</Label>
                                <Input id="foodAllowance" type="number" value={structure.foodAllowance} onChange={(e) => setStructure({...structure, foodAllowance: parseFloat(e.target.value) || 0})} />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="travelAllowance">Travel Allowance</Label>
                                <Input id="travelAllowance" type="number" value={structure.travelAllowance} onChange={(e) => setStructure({...structure, travelAllowance: parseFloat(e.target.value) || 0})} />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="commission">Commission</Label>
                                <Input id="commission" type="number" value={structure.commission} onChange={(e) => setStructure({...structure, commission: parseFloat(e.target.value) || 0})} />
                            </div>
                            
                            <div className="space-y-2">
                                <Label htmlFor="otherAllowances">Other Allowances</Label>
                                <Input id="otherAllowances" type="number" value={structure.otherAllowances} onChange={(e) => setStructure({...structure, otherAllowances: parseFloat(e.target.value) || 0})} />
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
                                    formData.append("housingAllowance", (structure.housingAllowance || 0).toString());
                                    formData.append("transportAllowance", (structure.transportAllowance || 0).toString());
                                    formData.append("medicalAllowance", (structure.medicalAllowance || 0).toString());
                                    formData.append("foodAllowance", (structure.foodAllowance || 0).toString());
                                    formData.append("travelAllowance", (structure.travelAllowance || 0).toString());
                                    formData.append("commission", (structure.commission || 0).toString());
                                    formData.append("otherAllowances", (structure.otherAllowances || 0).toString());
                                    formData.append("paymentMethod", structure.paymentMethod || "BANK_TRANSFER");

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
