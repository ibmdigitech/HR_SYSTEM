"use server";import { getConfig } from "@/lib/config-service";import { auth } from "@/auth";
import prisma from "@/lib/prisma";import { requirePermission } from "@/lib/auth/guards";import { PERMISSIONS } from "@/lib/auth/permissions";
export interface CompanySettings {
    name: string;
    logo: string;
    address: string;
    phone: string;
    email: string;
    website: string;
    signature: string;
    letterhead: string;
}

export async function getCompanySettings(): Promise<CompanySettings> {
    const name = await getConfig("COMPANY", "name") || "IBMDigiTech LLC";
    const logo = await getConfig("COMPANY", "logo") || "";
    const address = await getConfig("COMPANY", "address") || "Dubai, UAE";
    const phone = await getConfig("COMPANY", "phone") || "+971 4 123 4567";
    const email = await getConfig("COMPANY", "email") || "hr@ibmdigitech.com";
    const website = await getConfig("COMPANY", "website") || "https://ibmdigitech.com";
    const signature = await getConfig("COMPANY", "signature") || "";
    const letterhead = await getConfig("COMPANY", "letterhead") || "";

    return {
        name: String(name),
        logo: String(logo),
        address: String(address),
        phone: String(phone),
        email: String(email),
        website: String(website),
        signature: String(signature),
        letterhead: String(letterhead),
    };
}
/** Company identity shown on official letters; accessible to letter viewers. */export async function getLetterBranding(): Promise<CompanySettings> {    await requirePermission(PERMISSIONS.LETTER_VIEW);    return getCompanySettings();}
export async function updateCompanySettings(data: Partial<CompanySettings>) {
    const session = await auth();
    if (!session || ((session.user as { role?: string })?.role !== "ADMIN" && (session.user as { role?: string })?.role !== "HR")) {
        throw new Error("Unauthorized to modify company settings.");
    }
    validateBrandAsset(data.logo, "Company logo");    validateBrandAsset(data.signature, "HR signature");    validateBrandAsset(data.letterhead, "Letterhead");    const settings: Array<[keyof CompanySettings, string]> = [        ["name", "Company Name"], ["logo", "Company Logo"], ["address", "Company Address"],        ["phone", "Phone Number"], ["email", "Email Address"], ["website", "Website"],        ["signature", "Authorized Signature"], ["letterhead", "Letterhead"],    ];    await prisma.$transaction(settings        .filter(([key]) => data[key] !== undefined)        .map(([key, label]) => {            const value = String(data[key] ?? "");            return prisma.serviceConfig.upsert({                where: { module_key: { module: "COMPANY", key } },                update: { value, type: "text" },                create: { module: "COMPANY", key, value, type: "text", label },            });        }));
    return { success: true, message: "Company profile updated successfully!" };
}
function validateBrandAsset(value: string | undefined, label: string): void {    if (value === undefined || value === "") return;    const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);    if (!match) throw new Error(`${label} must be a PNG or JPEG image.`);    const bytes = Buffer.from(match[2], "base64");    if (bytes.length > 500 * 1024) throw new Error(`${label} must be 500KB or smaller.`);    const isPng = match[1].toLowerCase() === "png";    const hasValidHeader = isPng        ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))        : bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;    if (!hasValidHeader) throw new Error(`${label} image data is invalid.`);}