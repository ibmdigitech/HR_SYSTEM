import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, Briefcase, UserMinus } from "lucide-react";

export default function LettersDashboard() {
    return (
        <div className="p-8 space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">Letter Generation</h1>
            <p className="text-muted-foreground">Generate official limits automatically.</p>

            <div className="grid gap-6 md:grid-cols-3">
                <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Mail className="h-5 w-5" />
                            Offer Letter
                        </CardTitle>
                        <CardDescription>Send offers to new candidates.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Link href="/letters/offer">
                            <Button className="w-full" variant="outline">Create Offer</Button>
                        </Link>
                    </CardContent>
                </Card>

                <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Briefcase className="h-5 w-5" />
                            Appointment Letter
                        </CardTitle>
                        <CardDescription>Confirm employment for new hires.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Link href="/letters/appointment">
                            <Button className="w-full" variant="outline">Create Appointment</Button>
                        </Link>
                    </CardContent>
                </Card>

                <Card className="hover:bg-accent/50 transition-colors cursor-pointer">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <UserMinus className="h-5 w-5" />
                            Relieving Letter
                        </CardTitle>
                        <CardDescription>Process exit documentation.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Link href="/letters/relieving">
                            <Button className="w-full" variant="outline">Create Relieving</Button>
                        </Link>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
