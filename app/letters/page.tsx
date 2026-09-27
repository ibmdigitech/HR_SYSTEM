import { auth } from "@/auth";
import { redirect } from "next/navigation";
import LettersPageClient from "./LettersPageClient";

export const metadata = {
    title: "Letter Management | HR System",
    description: "Official UAE-compliant letter generation and governance system.",
};

export default async function LettersPage() {
    const session = await auth();
    if (!session) redirect("/login");

    const userRole = (session.user as { role: string }).role || "STAFF";

    return (
        <div className="container mx-auto py-10">
            <LettersPageClient userRole={userRole} />
        </div>
    );
}
