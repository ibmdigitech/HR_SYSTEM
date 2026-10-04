import jsPDF from "jspdf";

export type LetterBranding = {
    name?: string;
    logo?: string;
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
    signature?: string;
    letterhead?: string;
};

/**
 * The single PDF engine for every letter in the system.
 *
 * P1 §15: offers must NOT get a second renderer. This function is reused for
 * offer letters, which is why it accepts a letter whose subject is a
 * CANDIDATE rather than an employee — an offer is issued before the person is
 * ever onboarded (§19).
 *
 * `employee` is therefore optional; `candidate` is the fallback subject.
 */
export const generateLetterPDF = async (letter: any, branding: LetterBranding = {}) => {
    const doc = new jsPDF('p', 'mm', 'a4');
    const { referenceNumber, employee, candidate, template, content_en, content_ar } = letter;
    const subject = employee ?? candidate;
    const name = subject ? `${subject.firstName} ${subject.lastName}` : "—";

    const hasLetterhead = Boolean(branding.letterhead);
    if (branding.letterhead) {
        doc.addImage(branding.letterhead, imageFormat(branding.letterhead), 0, 0, 210, 297);
    } else {
        // A company-uploaded letterhead is a full-page A4 background. When
        // there is none, compose a simple header from the saved company data.
        doc.setFont("helvetica", "bold");
        doc.setFontSize(20);
        doc.setTextColor(15, 23, 42);
        doc.text(branding.name?.trim() || "Company", 20, 25);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        const contact = [branding.address, branding.phone, branding.email, branding.website]
            .filter((value): value is string => Boolean(value?.trim()));
        contact.forEach((value, index) => doc.text(value, 20, 33 + index * 4));
        if (branding.logo) {
            try { doc.addImage(branding.logo, imageFormat(branding.logo), 165, 15, 25, 25); }
            catch (error) { console.error("Failed to add company logo to letter:", error); }
        }
        doc.setDrawColor(79, 70, 229);
        doc.setLineWidth(1.2);
        doc.line(20, 55, 190, 55);
    }

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

    if (branding.signature) {
        try {
            doc.addImage(branding.signature, imageFormat(branding.signature), 20, sigY, 40, 20, undefined, "FAST");
        } catch (error) {
            console.error("Failed to add configured company signature to letter:", error);
        }
    }
    
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(15, 23, 42);
    doc.text("Manager / Authorized Signatory", 20, sigY + 30);
    
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(150);
    doc.text(`${branding.name?.trim() || "Company"} HR Department`, 20, sigY + 35);

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

function imageFormat(dataUrl: string): "PNG" | "JPEG" | "WEBP" {
    const mimeType = /^data:image\/(png|jpe?g|webp);/i.exec(dataUrl)?.[1]?.toLowerCase();
    if (mimeType === "jpg" || mimeType === "jpeg") return "JPEG";
    if (mimeType === "webp") return "WEBP";
    return "PNG";
}
