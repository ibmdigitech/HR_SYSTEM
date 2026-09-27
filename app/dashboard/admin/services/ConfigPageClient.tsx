"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle,  } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, RotateCcw, Search, ShieldCheck, CreditCard, Calendar, Briefcase, FileUp, Workflow, Bell, Info, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConfigItem {
    id: string;
    module: string;
    key: string;
    label: string;
    description: string | null;
    type: string;
    value: string;
    options?: unknown;
    isActive: boolean;
}

const MODULES = [
    { id: 'general',      label: 'General',      icon: ShieldCheck },
    { id: 'payroll',      label: 'Payroll',      icon: CreditCard },
    { id: 'attendance',   label: 'Attendance',   icon: Calendar },
    { id: 'leave',        label: 'Leave',        icon: Briefcase },
    { id: 'visa',         label: 'Visa & Docs',  icon: FileUp },
    { id: 'workflow',     label: 'Workflow',     icon: Workflow },
    { id: 'notifications', label: 'Notifications', icon: Bell },
];

export default function ConfigPageClient() {
    const [configs, setConfigs] = useState<ConfigItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [resetting, setResetting] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");

    useEffect(() => {
        fetchConfigs();
    }, []);

    const fetchConfigs = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/configs');
            if (!res.ok) throw new Error();
            const data = await res.json();
            setConfigs(data);
        } catch (error) {
            toast.error("Failed to load configurations");
        } finally {
            setLoading(false);
        }
    };

    const handleUpdate = async (config: ConfigItem, newValue: string) => {
        setSaving(config.id);
        try {
            const res = await fetch('/api/configs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...config, value: newValue }),
            });

            if (!res.ok) throw new Error();
            
            const updated = await res.json();
            setConfigs(prev => prev.map(c => c.id === updated.id ? updated : c));
            toast.success(`${config.label} updated successfully`);
        } catch (error) {
            toast.error(`Failed to update ${config.label}`);
        } finally {
            setSaving(null);
        }
    };

    const handleReset = async () => {
        if (!confirm("Are you sure you want to reset all configurations to system defaults? This cannot be undone.")) return;
        
        setResetting(true);
        try {
            const res = await fetch('/api/configs/reset', { method: 'POST' });
            if (!res.ok) throw new Error();
            await fetchConfigs();
            toast.success("Configurations reset to default");
        } catch (error) {
            toast.error("Failed to reset configurations");
        } finally {
            setResetting(false);
        }
    };

    const filteredConfigs = configs.filter(c => 
        c.label.toLowerCase().includes(searchTerm.toLowerCase()) || 
        c.key.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const renderConfigField = (config: ConfigItem) => {
        const isSaving = saving === config.id;

        switch (config.type) {
            case 'boolean':
                return (
                    <div className="flex items-center space-x-2">
                        <Switch 
                            checked={config.value === 'true'} 
                            onCheckedChange={(checked) => handleUpdate(config, checked ? 'true' : 'false')}
                            disabled={isSaving}
                        />
                        <Label className="text-xs text-slate-500">{config.value === 'true' ? 'Enabled' : 'Disabled'}</Label>
                    </div>
                );
            case 'number':
                return (
                    <Input 
                        type="number" 
                        defaultValue={config.value} 
                        className="max-w-[150px] h-9"
                        onBlur={(e) => {
                            if (e.target.value !== config.value) handleUpdate(config, e.target.value);
                        }}
                        disabled={isSaving}
                    />
                );
            case 'select': {
                // `payroll_cycle` shipped with `options = NULL`, so the dropdown
                // rendered empty and the setting could not be changed at all.
                // When no options are configured, fall back to the current value
                // so the control still shows and can be corrected, and say so
                // rather than presenting a dead control.
                const configured = Array.isArray(config.options) ? (config.options as unknown[]).filter((o) => typeof o === 'string') as string[] : [];
                const options = configured.length > 0
                    ? configured
                    : config.value
                        ? [config.value]
                        : [];
                const unconfigured = configured.length === 0;

                if (unconfigured) {
                    return (
                        <div className="space-y-1.5">
                            <Input
                                value={config.value}
                                onChange={(e) => handleUpdate(config, e.target.value)}
                                disabled={isSaving}
                                placeholder="e.g. Monthly"
                                className="max-w-[220px] h-9 bg-slate-50 dark:bg-slate-900"
                            />
                            <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
                                No options configured — enter a value directly.
                            </p>
                        </div>
                    );
                }

                return (
                    <div className="space-y-1.5">
                        <Select
                            value={config.value || undefined}
                            onValueChange={(val) => handleUpdate(config, val)}
                            disabled={isSaving}
                        >
                            <SelectTrigger className="max-w-[220px] h-9">
                                <SelectValue placeholder="Select option" />
                            </SelectTrigger>
                            <SelectContent>
                                {options.map((opt) => (
                                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-[10px] text-slate-400">
                            {options.length} option{options.length === 1 ? "" : "s"}
                        </p>
                    </div>
                );
            }
            case 'json':
                return (
                    <div className="space-y-2">
                        <textarea
                            className="w-full h-24 p-2 text-xs font-mono bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
                            defaultValue={config.value}
                            onBlur={(e) => {
                                try {
                                    JSON.parse(e.target.value);
                                    if (e.target.value !== config.value) handleUpdate(config, e.target.value);
                                } catch (err) {
                                    toast.error("Invalid JSON format");
                                }
                            }}
                            disabled={isSaving}
                        />
                        <p className="text-[10px] text-slate-400">Must be valid JSON array or object</p>
                    </div>
                );
            default:
                return (
                    <Input 
                        defaultValue={config.value} 
                        className="max-w-md h-9"
                        onBlur={(e) => {
                            if (e.target.value !== config.value) handleUpdate(config, e.target.value);
                        }}
                        disabled={isSaving}
                    />
                );
        }
    };

    if (loading) {
        return (
            <div className="h-[60vh] flex flex-col items-center justify-center gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-indigo-600" />
                <p className="text-slate-500 font-medium animate-pulse">Loading system configurations...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white dark:bg-slate-950 p-8 rounded-3xl border border-slate-200/60 dark:border-slate-800/60 shadow-sm relative overflow-hidden">
                {/* Decorative background */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl -mr-32 -mt-32"></div>
                
                <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="h-10 w-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
                            <Settings2 className="h-6 w-6" />
                        </div>
                        <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white uppercase italic">Service Configuration</h1>
                    </div>
                    <p className="text-slate-500 dark:text-slate-400 max-w-lg">
                        Central control panel for dynamic system rules and business logic. 
                        Changes apply in real-time across all HR modules.
                    </p>
                </div>

                <div className="flex items-center gap-3 relative z-10">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input 
                            placeholder="Search config..." 
                            className="pl-10 h-11 w-64 rounded-2xl border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <Button 
                        variant="outline" 
                        size="icon" 
                        className="h-11 w-11 rounded-2xl border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-900 transition-all"
                        onClick={handleReset}
                        disabled={resetting}
                    >
                        {resetting ? <Loader2 className="h-5 w-5 animate-spin" /> : <RotateCcw className="h-5 w-5" />}
                    </Button>
                </div>
            </div>

            {/* Main Tabs Container */}
            <Tabs defaultValue="payroll" className="w-full min-w-0 space-y-8">
                {/* `w-fit` made the strip exactly as wide as 7 padded tabs, so it
                    ran off the right edge with no way to reach the later tabs.
                    Full width plus horizontal scroll keeps every module
                    reachable on any viewport. */}
                <div className="w-full min-w-0 overflow-x-auto rounded-3xl bg-slate-100/50 dark:bg-slate-900/50 p-2 border border-slate-200/50 dark:border-slate-800/50 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <TabsList className="bg-transparent h-auto p-0 gap-2 w-max min-w-full justify-start">
                        {MODULES.map(m => (
                            <TabsTrigger
                                key={m.id}
                                value={m.id}
                                className={cn(
                                    "px-4 sm:px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all duration-300 whitespace-nowrap shrink-0",
                                    "data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:text-indigo-600 data-[state=active]:shadow-xl data-[state=active]:shadow-indigo-500/10",
                                    "data-[state=inactive]:text-slate-500 hover:text-indigo-600"
                                )}
                            >
                                <m.icon className="h-4 w-4 mr-2" />
                                {m.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </div>

                {MODULES.map(module => (
                    <TabsContent key={module.id} value={module.id} className="space-y-6 outline-none focus:ring-0">
                        <div className="grid gap-6">
                            {filteredConfigs
                                .filter(c => c.module === module.id)
                                .map(config => (
                                    <Card key={config.id} className="border-none bg-white dark:bg-slate-950 shadow-sm hover:shadow-md transition-all duration-300 rounded-3xl overflow-hidden group">
                                        <CardContent className="p-0">
                                            <div className="flex flex-col md:flex-row md:items-center justify-between p-8 gap-8">
                                                <div className="space-y-1.5 flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <h3 className="font-black text-slate-900 dark:text-white uppercase tracking-tight italic">
                                                            {config.label}
                                                        </h3>
                                                        <Badge variant="outline" className="text-[9px] font-bold uppercase tracking-tighter bg-slate-50 text-slate-400 border-slate-200">
                                                            {config.key}
                                                        </Badge>
                                                    </div>
                                                    <p className="text-sm text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                                                        <Info className="h-3.5 w-3.5 text-indigo-500/50" />
                                                        {config.description || `Configure system behavior for ${config.label.toLowerCase()}.`}
                                                    </p>
                                                </div>

                                                <div className="flex items-center gap-6 bg-slate-50 dark:bg-slate-900/50 p-6 rounded-2xl border border-slate-100 dark:border-slate-800 group-hover:border-indigo-500/30 transition-all duration-300">
                                                    <div className="flex flex-col gap-1 min-w-[200px]">
                                                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">Current Value</span>
                                                        {renderConfigField(config)}
                                                    </div>
                                                    
                                                    {saving === config.id && (
                                                        <div className="h-10 w-10 rounded-full bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center">
                                                            <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}

                            {filteredConfigs.filter(c => c.module === module.id).length === 0 && (
                                <div className="text-center p-20 bg-slate-50/50 dark:bg-slate-900/50 rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-800">
                                    <div className="h-16 w-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
                                        <Search className="h-8 w-8 text-slate-300" />
                                    </div>
                                    <h4 className="text-lg font-bold text-slate-400">No configurations found in this module</h4>
                                    <p className="text-sm text-slate-500">Try adjusting your search or reset to defaults.</p>
                                </div>
                            )}
                        </div>
                    </TabsContent>
                ))}
            </Tabs>

            {/* Footer Audit Info */}
            <div className="flex items-center justify-between p-6 bg-indigo-600 rounded-3xl text-white shadow-2xl shadow-indigo-500/20 overflow-hidden relative">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -mr-16 -mt-16"></div>
                <div className="flex items-center gap-4 relative z-10">
                    <div className="h-12 w-12 rounded-2xl bg-white/20 flex items-center justify-center backdrop-blur-md">
                        <ShieldCheck className="h-6 w-6" />
                    </div>
                    <div>
                        <h4 className="font-black text-sm uppercase tracking-widest leading-none">Security Enforcement Active</h4>
                        <p className="text-[10px] text-indigo-100 mt-1">Only authenticated Administrators can modify these system-wide settings.</p>
                    </div>
                </div>
                <div className="text-right relative z-10">
                    <span className="text-[9px] font-black uppercase tracking-[0.2em] opacity-50 block mb-1">System Environment</span>
                    <Badge className="bg-white text-indigo-600 hover:bg-white font-black tracking-tighter px-3">PRODUCTION READY v2.4</Badge>
                </div>
            </div>
        </div>
    );
}
