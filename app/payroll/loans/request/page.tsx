'use client';

import { useFormState, useFormStatus } from "react-dom";
import { requestLoan } from "@/app/lib/actions/loan";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, CheckCircle2, ChevronLeft, Banknote } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useEffect, useState } from "react";

const initialState = { message: "", success: false };

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" className="w-full h-12 text-base font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl" disabled={pending}>
            {pending ? "Submitting Request..." : "Submit Loan Request"}
        </Button>
    );
}

export default function LoanRequestPage() {
    const [state, formAction] = useFormState(requestLoan, initialState);
    const [amount, setAmount] = useState<number>(0);
    const [installment, setInstallment] = useState<number>(0);

    const monthsToRepay = amount > 0 && installment > 0 ? Math.ceil(amount / installment) : 0;

    return (
        <div className="max-w-2xl mx-auto p-4 md:p-8 space-y-6">
            <Link href="/payroll/loans" className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors">
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back to Loans Dashboard
            </Link>

            <Card className="rounded-[2rem] border-slate-100 shadow-xl overflow-hidden">
                <div className="bg-gradient-to-r from-indigo-500 to-violet-600 p-8 text-white">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2 bg-white/20 rounded-lg">
                            <Banknote className="h-6 w-6 text-white" />
                        </div>
                        <h1 className="text-2xl font-black tracking-tight">Request Salary Advance / Loan</h1>
                    </div>
                    <p className="text-indigo-100 font-medium">Loans are subject to Manager, HR, and Finance approval.</p>
                </div>
                
                <CardContent className="p-8">
                    {state?.message && (
                        <Alert variant={state.success ? "default" : "destructive"} className={`mb-6 ${state.success ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : ''}`}>
                            {state.success ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertCircle className="h-4 w-4" />}
                            <AlertTitle>{state.success ? "Success" : "Error"}</AlertTitle>
                            <AlertDescription>{state.message}</AlertDescription>
                        </Alert>
                    )}

                    <form action={formAction} className="space-y-6">
                        <div className="space-y-4">
                            <div className="grid gap-2">
                                <Label htmlFor="amount" className="font-bold text-slate-700">Requested Amount (AED)</Label>
                                <Input 
                                    id="amount" 
                                    name="amount" 
                                    type="number" 
                                    placeholder="e.g. 5000" 
                                    required 
                                    min="100"
                                    className="h-12 rounded-xl text-lg"
                                    onChange={(e) => setAmount(Number(e.target.value))}
                                />
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="installmentAmount" className="font-bold text-slate-700">Monthly Deduction Installment (AED)</Label>
                                <Input 
                                    id="installmentAmount" 
                                    name="installmentAmount" 
                                    type="number" 
                                    placeholder="e.g. 1000" 
                                    required 
                                    min="100"
                                    className="h-12 rounded-xl text-lg"
                                    onChange={(e) => setInstallment(Number(e.target.value))}
                                />
                                {monthsToRepay > 0 && (
                                    <p className="text-xs font-bold text-indigo-600 mt-1">
                                        Estimated Repayment Period: {monthsToRepay} months
                                    </p>
                                )}
                            </div>

                            <div className="grid gap-2">
                                <Label htmlFor="reason" className="font-bold text-slate-700">Reason for Request</Label>
                                <Textarea 
                                    id="reason" 
                                    name="reason" 
                                    placeholder="Please provide details to help expedite your approval..." 
                                    required 
                                    className="min-h-[120px] rounded-xl resize-none"
                                />
                            </div>
                        </div>

                        <SubmitButton />
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
