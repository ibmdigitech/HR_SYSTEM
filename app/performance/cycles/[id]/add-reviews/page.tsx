"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { createPerformanceReview } from "@/app/lib/actions/performance";
import { Users, ArrowLeft } from "lucide-react";
import Link from "next/link";

interface Employee {
    id: string;
    firstName: string;
    lastName: string;
    designation: string;
    department: string;
}

export default function AddReviewsToCyclePage({ params }: { params: Promise<{ id: string }> }) {
    const router = useRouter();
    const [cycleId, setCycleId] = useState<string>("");
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [selected, setSelected] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(true);

    useEffect(() => {
        params.then(p => {
            setCycleId(p.id);
            fetch(`/api/employees`)
                .then(r => r.json())
                .then((data: any) => {
                    setEmployees(Array.isArray(data) ? data : data.data || []);
                })
                .catch(() => toast.error("Failed to load employees"))
                .finally(() => setFetching(false));
        });
    }, [params]);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        try {
            let created = 0;
            for (const empId of selected) {
                const formData = new FormData();
                formData.append("cycleId", cycleId);
                formData.append("employeeId", empId);
                const res = await createPerformanceReview(formData);
                if (res.success) created++;
                else toast.error(`Failed for employee ${empId}: ${res.error}`);
            }
            toast.success(`Added ${created} review${created !== 1 ? "s" : ""} to cycle`);
            router.push(`/performance/cycles/${cycleId}`);
        } catch (e) {
            toast.error("An unexpected error occurred");
        } finally {
            setLoading(false);
        }
    }

    function toggle(id: string) {
        setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    }

    return (
        <div className="space-y-8 p-4 md:p-8 w-full max-w-4xl mx-auto">
            <div className="flex items-center gap-4">
                <Link href={`/performance/cycles/${cycleId}`}>
                    <Button variant="ghost" size="icon" className="rounded-xl">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                </Link>
                <div>
                    <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">Add Reviews</h1>
                    <p className="text-slate-500 text-sm font-medium">Select employees to include in this review cycle</p>
                </div>
            </div>

            <form onSubmit={handleSubmit}>
                <Card className="bg-white dark:bg-slate-950 border-slate-100 dark:border-slate-800/60 shadow-sm rounded-2xl">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Users className="h-5 w-5 text-violet-600" />
                            Select Employees
                        </CardTitle>
                        <CardDescription>Choose which employees will be reviewed in this cycle</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {fetching ? (
                            <p className="text-center text-slate-500 py-8">Loading employees...</p>
                        ) : employees.length === 0 ? (
                            <p className="text-center text-slate-500 py-8">No employees found.</p>
                        ) : (
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                {employees.map((emp) => (
                                    <label
                                        key={emp.id}
                                        className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${selected.includes(emp.id) ? "border-violet-500 bg-violet-50 dark:bg-violet-900/20" : "border-slate-100 dark:border-slate-800 hover:border-slate-300"}`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selected.includes(emp.id)}
                                            onChange={() => toggle(emp.id)}
                                            className="h-4 w-4 rounded"
                                        />
                                        <div>
                                            <p className="text-sm font-bold text-slate-900 dark:text-white">
                                                {emp.firstName} {emp.lastName}
                                            </p>
                                            <p className="text-xs text-slate-500">{emp.designation} · {emp.department}</p>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        )}

                        <div className="flex justify-end gap-3 mt-8">
                            <Link href={`/performance/cycles/${cycleId}`}>
                                <Button type="button" variant="outline">Cancel</Button>
                            </Link>
                            <Button type="submit" disabled={loading || selected.length === 0} className="gap-2">
                                {loading ? "Adding..." : `Add ${selected.length} Review${selected.length !== 1 ? "s" : ""}`}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </form>
        </div>
    );
}
