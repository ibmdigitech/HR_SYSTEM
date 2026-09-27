import { requirePageUser } from "@/lib/auth/page-guard";
// Dashboard letter list: any authenticated employee may view their own letters.

import { LetterGeneratorPage } from "./page-client";

export default async function Page() {
    await requirePageUser();
    return <LetterGeneratorPage />;
}