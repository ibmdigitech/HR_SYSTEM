"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getShifts, createShift, updateShift, deleteShift } from "@/app/lib/actions/shifts";
import { Clock, Plus, Save, Trash2, Loader2, CalendarClock, Users } from "lucide-react";
import { toast } from "sonner";

export default function ShiftsPage() {
    const [shifts, setShifts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedShift, setSelectedShift] = useState<any | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    // Form state
    const [name, setName] = useState("");
    const [startTime, setStartTime] = useState("09:00");
    const [endTime, setEndTime] = useState("18:00");
    const [lateThreshold, setLateThreshold] = useState("15");
    const [monthlyLateThresholdHours, setMonthlyLateThresholdHours] = useState("4");
    const [weeklyOffs, setWeeklyOffs] = useState("SAT_SUN");

    useEffect(() => {
        loadShifts();
    }, []);

    const loadShifts = async () => {
        setLoading(true);
        const res = await getShifts();
        if (res.success) {
            setShifts(res.data);
            if (res.data.length > 0 && !selectedShift) {
                selectShift(res.data[0]);
            }
        } else {
            toast.error("Failed to load shifts");
        }
        setLoading(false);
    };

    const selectShift = (s: any) => {
        setSelectedShift(s);
        setName(s.name);
        setStartTime(s.startTime);
        setEndTime(s.endTime);
        setLateThreshold(s.lateThreshold?.toString() || "15");
        setMonthlyLateThresholdHours(s.monthlyLateThresholdHours?.toString() || "4");
        setWeeklyOffs(s.weeklyOffs || "SAT_SUN");
    };

    const handleNew = () => {
        setSelectedShift(null);
        setName("");
        setStartTime("09:00");
        setEndTime("18:00");
        setLateThreshold("15");
        setMonthlyLateThresholdHours("4");
        setWeeklyOffs("SAT_SUN");
    };

    const handleSave = async () => {
        if (!name || !startTime || !endTime) {
            toast.error("Name and timings are required");
            return;
        }

        setIsSaving(true);
        const data = { 
            name, 
            startTime, 
            endTime, 
            lateThreshold: parseInt(lateThreshold) || 15,
            monthlyLateThresholdHours: parseInt(monthlyLateThresholdHours) || 4,
            weeklyOffs 
        };

        if (selectedShift) {
            const res = await updateShift(selectedShift.id, data);
            if (res.success) {
                toast.success("Shift updated");
                loadShifts();
            } else {
                toast.error(res.error || "Update failed");
            }
        } else {
            const res = await createShift(data);
            if (res.success) {
                toast.success("Shift created");
                loadShifts();
                setSelectedShift(res.data);
            } else {
                toast.error(res.error || "Creation failed");
            }
        }
        setIsSaving(false);
    };

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this shift?")) return;
        const res = await deleteShift(id);
        if (res.success) {
            toast.success("Deleted successfully");
            if (selectedShift?.id === id) {
                handleNew();
            }
            loadShifts();
        } else {
            toast.error("Failed to delete");
        }
    };

    const formatWeeklyOff = (code: string) => {
        const map: Record<string, string> = {
            "SAT_SUN": "Saturday & Sunday",
            "SUN": "Sunday Only",
            "FRI_SAT": "Friday & Saturday",
            "2ND_SAT_SUN": "2nd Saturday & Every Sunday",
            "ALT_SAT_SUN": "Alternative Saturdays & Every Sunday"
        };
        return map[code] || code;
    };

    return (
        <div className="space-y-6 p-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Shift Manager</h1>
                    <p className="text-slate-500 dark:text-slate-400">Configure working hours, late thresholds, and weekend policies.</p>
                </div>
                <Button onClick={handleNew} className="bg-indigo-600 hover:bg-indigo-700">
                    <Plus className="h-4 w-4 mr-2" />
                    New Shift
                </Button>
            </div>

            <div className="grid grid-cols-12 gap-6">
                {/* Sidebar list */}
                <Card className="col-span-12 md:col-span-4">
                    <CardHeader className="p-4 border-b">
                        <CardTitle className="text-lg">Active Shifts</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0 max-h-[600px] overflow-y-auto">
                        {loading ? (
                            <div className="p-8 flex justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
                        ) : shifts.length === 0 ? (
                            <div className="p-8 text-center text-slate-500 text-sm">No shifts configured.</div>
                        ) : (
                            <div className="flex flex-col">
                                {shifts.map((s) => (
                                    <div 
                                        key={s.id} 
                                        onClick={() => selectShift(s)}
                                        className={`p-4 border-b border-slate-100 cursor-pointer hover:bg-slate-50 flex items-start justify-between group ${selectedShift?.id === s.id ? 'bg-indigo-50/50 border-l-4 border-l-indigo-600' : 'border-l-4 border-l-transparent'}`}
                                    >
                                        <div>
                                            <p className="font-semibold text-sm text-slate-900">{s.name}</p>
                                            <p className="text-[10px] uppercase font-bold text-slate-500 mt-1 flex items-center gap-1">
                                                <Clock className="h-3 w-3" /> {s.startTime} - {s.endTime}
                                            </p>
                                        </div>
                                        <div className="flex flex-col items-end gap-2">
                                            <Badge variant="outline" className="text-[9px] h-5 bg-white">
                                                <Users className="h-3 w-3 mr-1" />
                                                {s._count?.employees || 0}
                                            </Badge>
                                            <Button 
                                                variant="ghost" 
                                                size="icon" 
                                                onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                                                className="h-6 w-6 text-slate-400 hover:text-rose-600 opacity-0 group-hover:opacity-100"
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Editor */}
                <Card className="col-span-12 md:col-span-8">
                    <CardHeader className="p-6 border-b bg-slate-50/50">
                        <div className="flex justify-between items-center">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
                                    <CalendarClock className="h-5 w-5" />
                                </div>
                                <div>
                                    <CardTitle>{selectedShift ? 'Edit Shift Policy' : 'Create New Shift'}</CardTitle>
                                    <CardDescription>Setup timings and attendance rules</CardDescription>
                                </div>
                            </div>
                            <Button onClick={handleSave} disabled={isSaving} className="bg-emerald-600 hover:bg-emerald-700">
                                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                                Save Shift
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="p-6 space-y-6">
                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2 col-span-2">
                                <Label>Shift Name</Label>
                                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Standard 09 to 18" />
                            </div>
                            
                            <div className="space-y-2">
                                <Label>Start Time</Label>
                                <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                            </div>
                            <div className="space-y-2">
                                <Label>End Time</Label>
                                <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                            </div>

                            <div className="space-y-2">
                                <Label>Late Threshold (Minutes)</Label>
                                <div className="flex items-center gap-2">
                                    <Input type="number" value={lateThreshold} onChange={(e) => setLateThreshold(e.target.value)} />
                                    <span className="text-xs text-slate-500 w-full">Grace period before marking late</span>
                                </div>
                            </div>
                            
                            <div className="space-y-2">
                                <Label>Monthly Late Threshold (Hours)</Label>
                                <div className="flex items-center gap-2">
                                    <Input type="number" value={monthlyLateThresholdHours} onChange={(e) => setMonthlyLateThresholdHours(e.target.value)} />
                                    <span className="text-xs text-slate-500 w-full">Max late hours before salary deduction</span>
                                </div>
                            </div>

                            <div className="space-y-2 col-span-2">
                                <Label>Weekend Policy (Weekly Offs)</Label>
                                <Select value={weeklyOffs} onValueChange={setWeeklyOffs}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="SAT_SUN">Saturday & Sunday Off</SelectItem>
                                        <SelectItem value="SUN">Sunday Only</SelectItem>
                                        <SelectItem value="FRI_SAT">Friday & Saturday</SelectItem>
                                        <SelectItem value="2ND_SAT_SUN">2nd Saturday & Every Sunday</SelectItem>
                                        <SelectItem value="ALT_SAT_SUN">Alternative Saturdays & Every Sunday</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

// Dummy Badge component as it might not be exported from ui/badge if it's missing in some templates
function Badge({ children, variant, className }: any) {
    return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${className}`}>{children}</span>
}
