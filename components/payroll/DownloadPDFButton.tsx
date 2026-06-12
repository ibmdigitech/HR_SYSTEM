"use client";

import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { getCompanySettings, CompanySettings } from "@/app/lib/actions/company-settings";

interface Props {
    record: any;
}

export function DownloadPDFButton({ record }: Props) {
    const [loading, setLoading] = useState(false);
    const [companySettings, setCompanySettings] = useState<CompanySettings>({
        name: "IBMDigiTech LLC",
        logo: "",
        address: "Dubai, UAE",
        phone: "+971 4 123 4567",
        email: "hr@ibmdigitech.com",
        website: "https://ibmdigitech.com",
        signature: "",
        letterhead: "",
    });

    useEffect(() => {
        getCompanySettings().then(setCompanySettings);
    }, []);


    const handleDownload = () => {
        setLoading(true);

        const emp = record.employee || {};
        const monthName = new Date(record.year, record.month - 1).toLocaleString("default", { month: "long" });

        // Earnings
        const earnings = [
            { label: "Basic Salary", amount: record.basic || 0 },
            { label: "Housing Allowance", amount: record.housingAllowance || 0 },
            { label: "Transport Allowance", amount: record.transportAllowance || 0 },
            { label: "Medical Allowance", amount: record.medicalAllowance || 0 },
            { label: "Food Allowance", amount: record.foodAllowance || 0 },
            { label: "Travel Allowance", amount: record.travelAllowance || 0 },
            { label: "Commission", amount: record.commission || 0 },
            { label: "Other Allowances", amount: record.otherAllowances || 0 },
            { label: "Overtime Pay", amount: record.overtimePay || 0 },
            { label: "Bonus", amount: record.bonus || 0 },
        ];

        // Deductions
        const deductions = [
            { label: "Late Penalty", amount: record.latePenalty || 0 },
            { label: "Penalty", amount: record.penalty || 0 },
            { label: "Leave Deduction", amount: record.leaveDeduction || 0 },
            { label: "Loan Deduction", amount: record.loanDeduction || 0 },
            { label: "Advance Salary", amount: record.advanceSalary || 0 },
            { label: "Other Deductions", amount: record.otherDeductions || 0 },
        ];

        const totalEarnings = earnings.reduce((sum, e) => sum + e.amount, 0);
        const totalDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);
        const netSalary = record.netSalary || 0;

        const fmt = (n: number) => n.toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const earningsRows = earnings
            .filter(e => e.amount > 0)
            .map(e => `<tr><td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#334155;font-size:13px;">${e.label}</td><td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;color:#1e293b;font-weight:600;font-size:13px;">AED ${fmt(e.amount)}</td></tr>`)
            .join("");

        const deductionRows = deductions
            .filter(d => d.amount > 0)
            .map(d => `<tr><td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#334155;font-size:13px;">${d.label}</td><td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;color:#dc2626;font-weight:600;font-size:13px;">AED ${fmt(d.amount)}</td></tr>`)
            .join("");

        const noDeductions = deductions.every(d => d.amount === 0);

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payslip - ${emp.firstName || ""} ${emp.lastName || ""} - ${monthName} ${record.year}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background: #f8fafc;
            color: #1e293b;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        @media print {
            body { background: white; }
            .no-print { display: none !important; }
            .payslip-container { box-shadow: none !important; margin: 0 !important; }
        }

        .print-bar {
            background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
            padding: 16px 32px;
            display: flex;
            justify-content: center;
            gap: 12px;
        }

        .print-bar button {
            padding: 10px 28px;
            border: none;
            border-radius: 10px;
            font-weight: 700;
            font-size: 14px;
            cursor: pointer;
            font-family: inherit;
            transition: all 0.2s;
        }

        .btn-print {
            background: white;
            color: #4f46e5;
        }

        .btn-close {
            background: rgba(255,255,255,0.15);
            color: white;
            backdrop-filter: blur(10px);
        }

        .btn-print:hover { background: #e0e7ff; }
        .btn-close:hover { background: rgba(255,255,255,0.25); }

        .payslip-container {
            max-width: 800px;
            margin: 32px auto;
            background: white;
            border-radius: 20px;
            box-shadow: 0 25px 50px -12px rgba(0,0,0,0.08);
            overflow: hidden;
        }

        .header {
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #312e81 100%);
            padding: 40px 40px 32px;
            position: relative;
            overflow: hidden;
        }

        .header::before {
            content: '';
            position: absolute;
            top: -50%;
            right: -20%;
            width: 400px;
            height: 400px;
            background: radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%);
            border-radius: 50%;
        }

        .header::after {
            content: '';
            position: absolute;
            bottom: -60%;
            left: -10%;
            width: 300px;
            height: 300px;
            background: radial-gradient(circle, rgba(139,92,246,0.1) 0%, transparent 70%);
            border-radius: 50%;
        }

        .company-name {
            font-size: 28px;
            font-weight: 900;
            color: white;
            letter-spacing: -0.5px;
            position: relative;
            z-index: 1;
        }

        .company-name span {
            background: linear-gradient(135deg, #818cf8, #a78bfa);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .payslip-title {
            font-size: 13px;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 3px;
            font-weight: 600;
            margin-top: 6px;
            position: relative;
            z-index: 1;
        }

        .payslip-badge {
            display: inline-block;
            margin-top: 12px;
            padding: 6px 16px;
            background: rgba(99,102,241,0.2);
            border: 1px solid rgba(99,102,241,0.3);
            border-radius: 20px;
            color: #a5b4fc;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.5px;
            position: relative;
            z-index: 1;
        }

        .confidential {
            position: absolute;
            top: 20px;
            right: 40px;
            color: rgba(255,255,255,0.15);
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 2px;
            text-transform: uppercase;
            z-index: 1;
        }

        .body-content {
            padding: 32px 40px 40px;
        }

        .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 32px;
        }

        .info-card {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 14px;
            padding: 20px;
        }

        .info-card-title {
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            color: #94a3b8;
            font-weight: 700;
            margin-bottom: 14px;
        }

        .info-row {
            display: flex;
            justify-content: space-between;
            padding: 5px 0;
        }

        .info-label {
            font-size: 12px;
            color: #64748b;
            font-weight: 500;
        }

        .info-value {
            font-size: 12px;
            color: #1e293b;
            font-weight: 700;
        }

        .tables-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 28px;
        }

        .table-section {
            border: 1px solid #e2e8f0;
            border-radius: 14px;
            overflow: hidden;
        }

        .table-header {
            padding: 14px 16px;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            font-weight: 800;
        }

        .table-header-earnings {
            background: linear-gradient(135deg, #ecfdf5, #d1fae5);
            color: #065f46;
            border-bottom: 1px solid #a7f3d0;
        }

        .table-header-deductions {
            background: linear-gradient(135deg, #fef2f2, #fecaca);
            color: #991b1b;
            border-bottom: 1px solid #fca5a5;
        }

        .table-total-row {
            background: #f8fafc;
            border-top: 2px solid #e2e8f0;
        }

        .table-total-row td {
            padding: 12px !important;
            font-weight: 800 !important;
            font-size: 14px !important;
        }

        .net-salary-section {
            background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
            border-radius: 16px;
            padding: 28px 32px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 28px;
            position: relative;
            overflow: hidden;
        }

        .net-salary-section::before {
            content: '';
            position: absolute;
            top: -50%;
            right: -10%;
            width: 200px;
            height: 200px;
            background: radial-gradient(circle, rgba(99,102,241,0.2) 0%, transparent 70%);
            border-radius: 50%;
        }

        .net-label {
            font-size: 13px;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 2px;
            font-weight: 700;
        }

        .net-amount {
            font-size: 36px;
            font-weight: 900;
            color: white;
            letter-spacing: -1px;
            margin-top: 4px;
        }

        .net-amount span {
            font-size: 18px;
            color: #818cf8;
            font-weight: 600;
        }

        .qr-box {
            width: 80px;
            height: 80px;
            background: rgba(255,255,255,0.1);
            border: 2px dashed rgba(255,255,255,0.2);
            border-radius: 12px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            position: relative;
            z-index: 1;
        }

        .qr-inner {
            width: 50px;
            height: 50px;
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            grid-template-rows: repeat(5, 1fr);
            gap: 2px;
        }

        .qr-cell {
            border-radius: 2px;
        }

        .qr-dark { background: rgba(255,255,255,0.6); }
        .qr-light { background: rgba(255,255,255,0.1); }

        .qr-label {
            font-size: 8px;
            color: rgba(255,255,255,0.4);
            font-weight: 600;
            margin-top: 4px;
            letter-spacing: 1px;
        }

        .payment-info {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 16px;
            margin-bottom: 28px;
        }

        .payment-item {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 14px 16px;
            text-align: center;
        }

        .payment-item-label {
            font-size: 10px;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 1px;
            font-weight: 600;
        }

        .payment-item-value {
            font-size: 13px;
            color: #1e293b;
            font-weight: 700;
            margin-top: 4px;
        }

        .footer {
            border-top: 1px solid #e2e8f0;
            padding: 24px 40px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #fafbfc;
        }

        .footer-left {
            font-size: 11px;
            color: #94a3b8;
            line-height: 1.8;
        }

        .footer-right {
            text-align: right;
        }

        .footer-company {
            font-size: 14px;
            font-weight: 800;
            color: #334155;
        }

        .footer-tagline {
            font-size: 10px;
            color: #94a3b8;
            letter-spacing: 0.5px;
        }

        .stamp-area {
            margin-top: 24px;
            padding-top: 20px;
            border-top: 1px dashed #e2e8f0;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 40px;
        }

        .stamp-box {
            text-align: center;
        }

        .stamp-line {
            border-bottom: 1px solid #cbd5e1;
            margin-bottom: 8px;
            height: 50px;
        }

        .stamp-label {
            font-size: 10px;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 1px;
            font-weight: 600;
        }
    </style>
</head>
<body>
    <div class="print-bar no-print">
        <button class="btn-print" onclick="window.print()">⬇ Download as PDF</button>
        <button class="btn-close" onclick="window.close()">✕ Close</button>
    </div>

    <div class="payslip-container">
        <!-- Header -->
        <div class="header">
            <div class="confidential">CONFIDENTIAL</div>
            ${companySettings.logo ? `<div class="company-logo" style="margin-bottom: 12px; display: flex; justify-content: center;"><img src="${companySettings.logo}" style="max-height: 48px; max-width: 180px; object-fit: contain;" /></div>` : `<div class="company-name">${companySettings.name}</div>`}
            <div class="payslip-title">Salary Statement</div>
            <div class="payslip-badge">${monthName} ${record.year} — Pay Period</div>
        </div>

        <!-- Body -->
        <div class="body-content">
            <!-- Employee Info -->
            <div class="info-grid">
                <div class="info-card">
                    <div class="info-card-title">Employee Details</div>
                    <div class="info-row">
                        <span class="info-label">Name</span>
                        <span class="info-value">${emp.firstName || ""} ${emp.lastName || ""}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Employee ID</span>
                        <span class="info-value">${emp.employeeCode || emp.rollNumber || "N/A"}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Department</span>
                        <span class="info-value">${emp.department || "N/A"}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Designation</span>
                        <span class="info-value">${emp.designation || "N/A"}</span>
                    </div>
                </div>
                <div class="info-card">
                    <div class="info-card-title">Payment Information</div>
                    <div class="info-row">
                        <span class="info-label">Pay Period</span>
                        <span class="info-value">${monthName} ${record.year}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Payment Method</span>
                        <span class="info-value">${(record.paymentMethod || "BANK_TRANSFER").replace(/_/g, " ")}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Bank</span>
                        <span class="info-value">${emp.bankName || "N/A"}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">IBAN</span>
                        <span class="info-value" style="font-size:11px;">${emp.iban ? emp.iban.substring(0, 8) + "****" + emp.iban.substring(emp.iban.length - 4) : "N/A"}</span>
                    </div>
                </div>
            </div>

            <!-- Earnings & Deductions -->
            <div class="tables-grid">
                <div class="table-section">
                    <div class="table-header table-header-earnings">✦ Earnings</div>
                    <table style="width:100%;border-collapse:collapse;">
                        <tbody>
                            ${earningsRows || '<tr><td colspan="2" style="padding:16px;text-align:center;color:#94a3b8;font-size:13px;">No earnings recorded</td></tr>'}
                            <tr class="table-total-row">
                                <td style="padding:12px;color:#065f46;">Total Earnings</td>
                                <td style="padding:12px;text-align:right;color:#065f46;">AED ${fmt(totalEarnings)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="table-section">
                    <div class="table-header table-header-deductions">✦ Deductions</div>
                    <table style="width:100%;border-collapse:collapse;">
                        <tbody>
                            ${noDeductions ? '<tr><td colspan="2" style="padding:16px;text-align:center;color:#94a3b8;font-size:13px;">No deductions applied</td></tr>' : deductionRows}
                            <tr class="table-total-row">
                                <td style="padding:12px;color:#991b1b;">Total Deductions</td>
                                <td style="padding:12px;text-align:right;color:#dc2626;">AED ${fmt(totalDeductions)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Net Salary -->
            <div class="net-salary-section">
                <div style="position:relative;z-index:1;">
                    <div class="net-label">Net Salary Payable</div>
                    <div class="net-amount"><span>AED </span>${fmt(netSalary)}</div>
                </div>
                <div class="qr-box">
                    <div class="qr-inner">
                        <div class="qr-cell qr-dark"></div><div class="qr-cell qr-light"></div><div class="qr-cell qr-dark"></div><div class="qr-cell qr-dark"></div><div class="qr-cell qr-dark"></div>
                        <div class="qr-cell qr-light"></div><div class="qr-cell qr-dark"></div><div class="qr-cell qr-light"></div><div class="qr-cell qr-dark"></div><div class="qr-cell qr-light"></div>
                        <div class="qr-cell qr-dark"></div><div class="qr-cell qr-dark"></div><div class="qr-cell qr-dark"></div><div class="qr-cell qr-light"></div><div class="qr-cell qr-dark"></div>
                        <div class="qr-cell qr-dark"></div><div class="qr-cell qr-light"></div><div class="qr-cell qr-dark"></div><div class="qr-cell qr-dark"></div><div class="qr-cell qr-light"></div>
                        <div class="qr-cell qr-dark"></div><div class="qr-cell qr-dark"></div><div class="qr-cell qr-light"></div><div class="qr-cell qr-light"></div><div class="qr-cell qr-dark"></div>
                    </div>
                    <div class="qr-label">VERIFY</div>
                </div>
            </div>

            <!-- Payment Summary -->
            <div class="payment-info">
                <div class="payment-item">
                    <div class="payment-item-label">Status</div>
                    <div class="payment-item-value" style="color:${record.status === "PAID" ? "#059669" : "#d97706"}">${record.status || "DRAFT"}</div>
                </div>
                <div class="payment-item">
                    <div class="payment-item-label">Paid Date</div>
                    <div class="payment-item-value">${record.paidAt ? new Date(record.paidAt).toLocaleDateString("en-GB") : "Pending"}</div>
                </div>
                <div class="payment-item">
                    <div class="payment-item-label">Account No.</div>
                    <div class="payment-item-value">${emp.accountNumber ? "****" + emp.accountNumber.slice(-4) : "N/A"}</div>
                </div>
            </div>

            <!-- Signature Area -->
            <div class="stamp-area">
                <div class="stamp-box">
                    <div class="stamp-line"></div>
                    <div class="stamp-label">Employee Signature</div>
                </div>
                <div class="stamp-box">
                    <div class="stamp-line" style="display: flex; align-items: flex-end; justify-content: center; height: 50px;">
                        ${companySettings.signature ? `<img src="${companySettings.signature}" style="max-height: 48px; max-width: 130px; object-fit: contain;" />` : ''}
                    </div>
                    <div class="stamp-label">Authorized Signatory</div>
                </div>
            </div>
        </div>

        <!-- Footer -->
        <div class="footer">
            <div class="footer-left">
                This is a system-generated payslip.<br>
                Generated on ${new Date().toLocaleDateString("en-GB")} at ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}<br>
                For queries, contact ${companySettings.email}
            </div>
            <div class="footer-right">
                <div class="footer-company">${companySettings.name}</div>
                <div class="footer-tagline">Human Resources Management System</div>
            </div>
        </div>
    </div>
</body>
</html>`;

        const printWindow = window.open("", "_blank");
        if (printWindow) {
            printWindow.document.write(html);
            printWindow.document.close();
        }
        setLoading(false);
    };

    return (
        <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 font-bold transition-all duration-200 hover:scale-105"
            onClick={handleDownload}
            disabled={loading}
        >
            {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
                <Download className="h-4 w-4" />
            )}
            PDF
        </Button>
    );
}
