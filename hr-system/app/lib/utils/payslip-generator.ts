import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export const generatePayslipPDF = (data: any) => {
    const doc = new jsPDF();
    const { employee, employeeId, month, year, basic, allowance, deduction, net, status, createdAt } = data;
    const name = `${employee?.firstName || ''} ${employee?.lastName || ''}`;

    // Header
    doc.setFontSize(22);
    doc.setTextColor(63, 81, 181); // Indigo color
    doc.text("P A Y S L I P", 105, 20, { align: "center" });

    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text("SmartIT UAE HR Management System", 105, 28, { align: "center" });

    // Divider
    doc.setDrawColor(200);
    doc.line(20, 35, 190, 35);

    // Employee Details Table
    autoTable(doc, {
        startY: 45,
        head: [['Employee Detail', 'Value']],
        body: [
            ['Name', name],
            ['Employee ID', employeeId],
            ['Pay Period', `${month} ${year}`],
            ['Status', status],
            ['Generated On', new Date().toLocaleDateString()]
        ],
        theme: 'striped',
        headStyles: { fillColor: [63, 81, 181] },
        styles: { fontSize: 9 }
    });

    // Earnings & Deductions
    autoTable(doc, {
        startY: doc.lastAutoTable.finalY + 10,
        head: [['Description', 'Amount (AED)']],
        body: [
            ['Basic Salary', basic.toFixed(2)],
            ['Allowances', allowance.toFixed(2)],
            ['Deductions', `(${deduction.toFixed(2)})`],
            [{ content: 'NET SALARY', styles: { fontStyle: 'bold' } }, { content: net.toFixed(2), styles: { fontStyle: 'bold' } }]
        ],
        theme: 'grid',
        headStyles: { fillColor: [63, 81, 181] },
        styles: { fontSize: 10 }
    });

    // Footer
    const finalY = doc.lastAutoTable.finalY + 30;
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text("This is an electronically generated document and does not require a signature.", 105, finalY, { align: "center" });
    doc.text("© 2026 SmartIT UAE", 105, finalY + 5, { align: "center" });

    // Save
    doc.save(`Payslip_${name.replace(/\s+/g, '_')}_${month}_${year}.pdf`);
};
