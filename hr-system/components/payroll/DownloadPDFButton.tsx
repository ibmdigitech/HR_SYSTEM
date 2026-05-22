"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { generatePayslipPDF } from "@/app/lib/utils/payslip-generator";

interface Props {
    record: any;
}

export function DownloadPDFButton({ record }: Props) {
    const handleDownload = () => {
        // Map all advanced fields to match generator expected format
        const data = {
            employee: record.employee,
            month: record.month,
            year: record.year,
            basic: record.basic || 0,
            housingAllowance: record.housingAllowance || 0,
            transportAllowance: record.transportAllowance || 0,
            medicalAllowance: record.medicalAllowance || 0,
            otherAllowances: record.otherAllowances || 0,
            latePenalty: record.latePenalty || 0,
            leaveDeduction: record.leaveDeduction || 0,
            loanDeduction: record.loanDeduction || 0,
            otherDeductions: record.otherDeductions || 0,
            overtimePay: record.overtimePay || 0,
            bonus: record.bonus || 0,
            net: record.netSalary || 0,
            status: record.status,
            paymentMethod: record.paymentMethod,
            createdAt: record.createdAt
        };
        
        generatePayslipPDF(data);
    };

    return (
        <Button 
            variant="ghost" 
            size="sm" 
            className="gap-2 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 font-bold"
            onClick={handleDownload}
        >
            <Download className="h-4 w-4" />
            PDF
        </Button>
    );
}
