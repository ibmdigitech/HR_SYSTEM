import ConfigPageClient from "./ConfigPageClient";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export const metadata = {
    title: "Service Configuration | HR System",
    description: "Manage system-wide HR business rules and configurations.",
};

export default async function ServiceConfigPage() {
    const session = await auth();
    
    // Security check: Only Admin can access
    if (!session || (session.user as any).role !== 'ADMIN') {
        redirect("/dashboard");
    }

    return (
        <div className="container mx-auto py-8">
            <ConfigPageClient />
        </div>
    );
}
