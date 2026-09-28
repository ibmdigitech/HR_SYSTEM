import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle,  } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Banknote, FileText, ChevronLeft, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { applyForLoan } from "@/app/lib/actions/loan-advanced";

export default async function ApplyLoanPage() {
    const session = await auth();
    if (!session?.user?.email) redirect("/login");

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { employee: true }
    });

    if (!user?.employee) redirect("/dashboard");

  // Check for probation and overdue loans (Basic implementation)
  const today = new Date();
  // `joiningDate` is nullable for a provisional (PRE_JOINING) employee. Reading
  // .getFullYear() off null throws and 500s the page, so fall back to today and
  // treat the employee as NOT on probation — there is no tenure to measure yet.
  const joinDate = user.employee.joiningDate ?? today;
  const hasTenure = user.employee.joiningDate !== null;
  const monthsSinceJoin = (today.getFullYear() - joinDate.getFullYear()) * 12 + (today.getMonth() - joinDate.getMonth());
  const isOnProbation = !hasTenure || monthsSinceJoin < 6;

    const loanTypes = await prisma.loanType.findMany({
        where: { isActive: true }
    });

    return (
        <div className="max-w-3xl mx-auto p-4 md:p-8 space-y-6">
            <Link href="/payroll/loans/my-loans" className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors">
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back to My Loans
            </Link>

            <Card className="rounded-[2.5rem] border-slate-100 shadow-2xl overflow-hidden bg-white">
                <div className="bg-gradient-to-br from-indigo-900 via-slate-900 to-indigo-950 p-8 md:p-10 text-white relative">
                    <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-indigo-500/20 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/2"></div>
                    <div className="relative z-10 flex items-center gap-4">
                        <div className="p-4 bg-white/10 rounded-2xl backdrop-blur-md">
                            <Banknote className="h-8 w-8 text-indigo-300" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black tracking-tight mb-1">New Loan Application</h1>
                            <p className="text-indigo-200 font-medium text-sm">Please fill out the form carefully. All requests are subject to approval.</p>
                        </div>
                    </div>
                </div>

                <CardContent className="p-8 md:p-10">
                    {!hasTenure && (
                        <div className="mb-8 p-4 bg-slate-100 rounded-2xl border border-slate-200 flex gap-3 text-slate-700">
                            <ShieldAlert className="h-5 w-5 shrink-0" />
                            <div>
                                <h4 className="font-bold">Profile incomplete</h4>
                                <p className="text-sm mt-1">
                                    Your joining date has not been recorded yet, so your tenure and
                                    probation status cannot be determined. Loan types requiring
                                    probation clearance are unavailable until HR completes your
                                    record.
                                </p>
                            </div>
                        </div>
                    )}
                    {hasTenure && isOnProbation && (
                        <div className="mb-8 p-4 bg-amber-50 rounded-2xl border border-amber-200 flex gap-3 text-amber-800">
                            <ShieldAlert className="h-5 w-5 shrink-0" />
                            <div>
                                <h4 className="font-bold">Probation Warning</h4>
                                <p className="text-sm mt-1">You are still within your 6-month probation period. Some loan types may be restricted or require special management approval.</p>
                            </div>
                        </div>
                    )}

                    <form action={async (formData: FormData) => { "use server"; await applyForLoan(formData); }} className="space-y-8">
                        <div className="grid gap-6 md:grid-cols-2">
                            {/* Read-only Employee Info */}
                            <div className="space-y-2">
                                <Label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Employee Name</Label>
                                <Input value={`${user.employee.firstName} ${user.employee.lastName}`} disabled className="bg-slate-50" />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Department</Label>
                                <Input value={user.employee.department || "N/A"} disabled className="bg-slate-50" />
                            </div>

                            {/* Loan Configuration */}
                            <div className="md:col-span-2 space-y-2">
                                <Label htmlFor="loanTypeId" className="text-xs font-bold text-slate-500 uppercase tracking-widest">Select Loan Type</Label>
                                <select 
                                    id="loanTypeId" 
                                    name="loanTypeId" 
                                    required
                                    className="w-full h-12 rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <option value="">Select a loan policy...</option>
                                    {loanTypes.map(lt => (
                                        <option key={lt.id} value={lt.id} disabled={isOnProbation && lt.requiresProbation}>
                                            {lt.name} (Max: {lt.maxAmount} AED, Max Terms: {lt.maxRepaymentMonths} months)
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="amount" className="text-xs font-bold text-slate-500 uppercase tracking-widest">Requested Amount (AED)</Label>
                                <Input id="amount" name="amount" type="number" min="100" required placeholder="e.g. 10000" className="h-12 text-lg font-bold" />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="months" className="text-xs font-bold text-slate-500 uppercase tracking-widest">Repayment Period (Months)</Label>
                                <Input id="months" name="months" type="number" min="1" required placeholder="e.g. 12" className="h-12 text-lg font-bold" />
                            </div>

                            <div className="md:col-span-2 space-y-2">
                                <Label htmlFor="reason" className="text-xs font-bold text-slate-500 uppercase tracking-widest">Reason / Justification</Label>
                                <Textarea id="reason" name="reason" required placeholder="Please provide specific details..." className="min-h-[120px] resize-none rounded-xl" />
                            </div>
                            
                            {/* Document Upload Placeholder */}
                            <div className="md:col-span-2 p-6 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center text-slate-500 bg-slate-50/50 hover:bg-slate-50 transition-colors cursor-pointer">
                                <FileText className="h-8 w-8 mb-2 opacity-50" />
                                <span className="text-sm font-bold">Upload Supporting Documents</span>
                                <span className="text-xs">PDF, JPG, PNG (Max 5MB)</span>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-slate-100 flex justify-end">
                            <Button type="submit" className="h-14 px-8 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-xl shadow-lg hover:shadow-indigo-500/25 transition-all text-base">
                                Submit Application
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
