'use client';

import { useState, useTransition } from "react";
import { processLoanApproval, disburseLoan } from "@/app/lib/actions/loan-advanced";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Clock, Banknote, ChevronDown, Loader2 } from "lucide-react";

interface LoanApprovalActionsProps {
    applicationId: string;
    currentStatus: string;
    managerStatus: string;
    hrStatus: string;
    financeStatus: string;
    userRole: string;
    isManager: boolean;
}

export function LoanApprovalActions({
    applicationId,
    currentStatus,
    managerStatus,
    hrStatus,
    financeStatus,
    userRole,
    isManager
}: LoanApprovalActionsProps) {
    const [isPending, startTransition] = useTransition();
    const [comment, setComment] = useState("");
    const [showDisbModal, setShowDisbModal] = useState(false);
    const [disbMethod, setDisbMethod] = useState("BANK_TRANSFER");
    const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);

    const handleApproval = (action: "APPROVED" | "REJECTED" | "ON_HOLD") => {
        let level: "MANAGER" | "HR" | "FINANCE" = "MANAGER";
        if (currentStatus === "PENDING_HR") level = "HR";
        else if (currentStatus === "PENDING_FINANCE") level = "FINANCE";

        startTransition(async () => {
            const res = await processLoanApproval(applicationId, level, action, comment);
            setMessage({ text: res.message, success: res.success });
            setComment("");
        });
    };

    const handleDisburse = () => {
        startTransition(async () => {
            const res = await disburseLoan(applicationId, disbMethod);
            setMessage({ text: res.message, success: res.success });
            setShowDisbModal(false);
        });
    };

    const canApproveAsManager = isManager && managerStatus === "PENDING" && currentStatus === "SUBMITTED";
    const canApproveAsHR = userRole === "HR" && hrStatus === "PENDING" && currentStatus === "PENDING_HR";
    const canApproveAsFinance = userRole === "FINANCE" && financeStatus === "PENDING" && currentStatus === "PENDING_FINANCE";
    const canDisburse = (userRole === "FINANCE" || userRole === "ADMIN") && currentStatus === "APPROVED";

    const canAct = canApproveAsManager || canApproveAsHR || canApproveAsFinance;

    if (message) {
        return (
            <div className={`text-xs font-bold px-3 py-2 rounded-xl ${message.success ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                {message.text}
            </div>
        );
    }

    if (canDisburse) {
        return (
            <div className="space-y-2">
                {showDisbModal ? (
                    <div className="p-3 bg-slate-50 rounded-xl border space-y-2">
                        <select
                            value={disbMethod}
                            onChange={e => setDisbMethod(e.target.value)}
                            className="w-full text-xs border rounded-lg px-2 py-1.5"
                        >
                            <option value="BANK_TRANSFER">Bank Transfer</option>
                            <option value="CASH">Cash</option>
                            <option value="SALARY_CREDIT">Salary Credit</option>
                        </select>
                        <div className="flex gap-2">
                            <Button size="sm" onClick={handleDisburse} disabled={isPending} className="flex-1 bg-indigo-600 text-white text-xs rounded-lg">
                                {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Banknote className="h-3 w-3 mr-1" />}
                                Disburse Now
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setShowDisbModal(false)} className="text-xs rounded-lg">Cancel</Button>
                        </div>
                    </div>
                ) : (
                    <Button size="sm" onClick={() => setShowDisbModal(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs rounded-xl font-bold">
                        <Banknote className="h-3 w-3 mr-1" /> Disburse Loan
                    </Button>
                )}
            </div>
        );
    }

    if (!canAct) {
        return <span className="text-xs text-slate-400 italic">No action required from you</span>;
    }

    return (
        <div className="space-y-2">
            <textarea
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Add comments (optional)..."
                className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2 resize-none h-16 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <div className="flex gap-2 flex-wrap">
                <Button
                    size="sm"
                    onClick={() => handleApproval("APPROVED")}
                    disabled={isPending}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-xl font-bold"
                >
                    {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                    Approve
                </Button>
                <Button
                    size="sm"
                    onClick={() => handleApproval("ON_HOLD")}
                    disabled={isPending}
                    variant="outline"
                    className="text-amber-700 border-amber-300 hover:bg-amber-50 text-xs rounded-xl font-bold"
                >
                    <Clock className="h-3 w-3 mr-1" /> On Hold
                </Button>
                <Button
                    size="sm"
                    onClick={() => handleApproval("REJECTED")}
                    disabled={isPending}
                    className="bg-rose-100 hover:bg-rose-200 text-rose-700 text-xs rounded-xl font-bold border-0"
                >
                    <XCircle className="h-3 w-3 mr-1" /> Reject
                </Button>
            </div>
        </div>
    );
}
