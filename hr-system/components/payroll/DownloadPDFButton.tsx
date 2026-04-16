"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { generatePayslipPDF } from "@/app/lib/utils/payslip-generator";

interface Props {
    record: any;
}

export function DownloadPDFButton({ record }: Props) {
    const handleDownload = () => {
        // Map record fields to match generator expected format
        const data = {
            employee: record.employee,
            employeeId: record.employeeId,
            month: record.month,
            year: record.year,
            basic: record.basic || 0,
            allowance: record.allowances || 0,
            deduction: record.deductions || 0,
            net: record.netSalary || 0,
            status: record.status,
            createdAt: record.createdAt
        };
        
        generatePayslipPDF(data);
    };

    return (
        <Button 
            variant="ghost" 
            size="sm" 
            className="gap-2 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
            onClick={handleDownload}
        >
            <Download className="h-3.5 w-3.5" />
            PDF
        </Button>
    );
}
