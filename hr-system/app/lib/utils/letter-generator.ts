import jsPDF from "jspdf";

export const generateLetterPDF = async (letter: any) => {
    const doc = new jsPDF('p', 'mm', 'a4');
    const { referenceNumber, employee, template, content_en, content_ar } = letter;
    const name = `${employee.firstName} ${employee.lastName}`;

    // Helper for horizontal line
    const line = (y: number) => {
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.5);
        doc.line(20, y, 190, y);
    };

    // Header / Letterhead
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(15, 23, 42); // Slate 900
    doc.text("AL BARAKAH", 20, 25);
    
    doc.setFontSize(8);
    doc.setTextColor(79, 70, 229); // Indigo 600
    doc.text("GROUP OF COMPANIES", 20, 30, { charSpace: 1 });

    doc.setTextColor(148, 163, 184); // Slate 400
    doc.setFontSize(7);
    doc.text("Industrial City, Abu Dhabi, UAE", 20, 38);
    doc.text("T: +971 2 XXX XXXX | E: info@albarakah.ae", 20, 42);
    doc.text("Trade License: TL-100234", 20, 46);

    // Header Logo Placeholder (AB)
    doc.setFillColor(15, 23, 42);
    doc.roundedRect(170, 20, 20, 20, 3, 3, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.text("AB", 180, 32, { align: 'center' });

    // Divider
    doc.setDrawColor(79, 70, 229);
    doc.setLineWidth(1.5);
    doc.line(20, 55, 190, 55);

    // Title & Reference
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(template.name.toUpperCase(), 105, 75, { align: "center" });

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100);
    doc.text(`Ref: ${referenceNumber}`, 20, 85);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 190, 85, { align: "right" });

    // Content area
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    
    // For English content
    const splitEn = doc.splitTextToSize(content_en, 170);
    doc.text(splitEn, 20, 100);

    // Signature Area
    const sigY = 230;

    // Fetch and add Stamp & Signature
    try {
        const [sigRes, stampRes] = await Promise.all([
            fetch('/assets/signature.png').then(r => r.blob()).then(blob => new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
            })),
            fetch('/assets/stamp.png').then(r => r.blob()).then(blob => new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(blob);
            }))
        ]);

        // Add Signature
        doc.addImage(sigRes, 'PNG', 20, sigY, 40, 20, undefined, 'FAST');
        // Add Stamp (positioned relative to signature like in UI)
        doc.addImage(stampRes, 'PNG', 45, sigY - 5, 25, 25, undefined, 'FAST');
    } catch (e) {
        console.error("Failed to load PDF assets", e);
    }
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text("Manager / Authorized Signatory", 20, sigY + 30);
    
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(150);
    doc.text("Al Barakah Group HR Department", 20, sigY + 35);

    // Verification ID
    doc.setFontSize(7);
    doc.setTextColor(79, 70, 229);
    doc.text(`VERIFIED ID: ${letter.id.slice(0, 12).toUpperCase()}`, 190, sigY + 35, { align: "right" });

    // Footer
    doc.setDrawColor(241, 245, 249);
    doc.line(20, 280, 190, 280);
    doc.setFontSize(7);
    doc.setTextColor(180);
    doc.text("This is a computer generated document and does not require a physical signature.", 105, 285, { align: "center" });

    // Download
    doc.save(`${template.name.replace(/\s+/g, '_')}_${name.replace(/\s+/g, '_')}.pdf`);
};
