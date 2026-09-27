"use server";import { getConfig, setConfig } from "@/lib/config-service";
import { auth } from "@/auth";

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

export async function updateCompanySettings(data: Partial<CompanySettings>) {
    const session = await auth();
    if (!session || ((session.user as { role?: string })?.role !== "ADMIN" && (session.user as { role?: string })?.role !== "HR")) {
        throw new Error("Unauthorized to modify company settings.");
    }

    if (data.name !== undefined) await setConfig("COMPANY", "name", data.name, "text", "Company Name");
    if (data.logo !== undefined) await setConfig("COMPANY", "logo", data.logo, "text", "Company Logo");
    if (data.address !== undefined) await setConfig("COMPANY", "address", data.address, "text", "Company Address");
    if (data.phone !== undefined) await setConfig("COMPANY", "phone", data.phone, "text", "Phone Number");
    if (data.email !== undefined) await setConfig("COMPANY", "email", data.email, "text", "Email Address");
    if (data.website !== undefined) await setConfig("COMPANY", "website", data.website, "text", "Website");
    if (data.signature !== undefined) await setConfig("COMPANY", "signature", data.signature, "text", "Authorized Signature");
    if (data.letterhead !== undefined) await setConfig("COMPANY", "letterhead", data.letterhead, "text", "Letter Head Template Details");

    return { success: true, message: "Company profile updated successfully!" };
}
