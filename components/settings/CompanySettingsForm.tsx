"use client";

import React, { useState } from "react";
import { CompanySettings, updateCompanySettings } from "@/app/lib/actions/company-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Building2, Mail, Phone, Globe, MapPin, Signature, FileImage, Save, Loader2 } from "lucide-react";

interface CompanySettingsFormProps {
    initialSettings: CompanySettings;
}

export function CompanySettingsForm({ initialSettings }: CompanySettingsFormProps) {
    const [settings, setSettings] = useState<CompanySettings>(initialSettings);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setSettings((prev) => ({ ...prev, [name]: value }));
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, field: "logo" | "signature" | "letterhead") => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!(["image/png", "image/jpeg"].includes(file.type))) {
            toast.error("Upload a PNG or JPEG image.");
            e.target.value = "";
            return;
        }

        // The server enforces the same limit before storing this image.
        if (file.size > 500 * 1024) {
            toast.error("File is too large. Please upload an image under 500KB.");
            e.target.value = "";
            return;
        }

        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === "string") {
                setSettings((prev) => ({ ...prev, [field]: reader.result as string }));
                toast.success(`${field.charAt(0).toUpperCase() + field.slice(1)} loaded successfully!`);
            }
        };
        reader.onerror = () => toast.error("Could not read this image. Try another file.");
        reader.readAsDataURL(file);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            const res = await updateCompanySettings(settings);
            if (res.success) {
                toast.success("Company profile updated successfully!");
                // Force a reload or update context if needed
            } else {
                toast.error("Failed to update company profile.");
            }
        } catch (error: unknown) {
            console.error(error);
            toast.error((error instanceof Error ? error.message : "Unknown error") || "An error occurred.");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
                {/* Left Column: Standard details */}
                <div className="space-y-4">
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-2">Company Name</label>
                        <div className="relative">
                            <Building2 className="absolute left-3 top-3.5 h-5 w-5 text-slate-400" />
                            <Input
                                name="name"
                                value={settings.name}
                                onChange={handleInputChange}
                                className="pl-10 h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-2">Primary Email</label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-3.5 h-5 w-5 text-slate-400" />
                            <Input
                                name="email"
                                type="email"
                                value={settings.email}
                                onChange={handleInputChange}
                                className="pl-10 h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-2">Phone Number</label>
                        <div className="relative">
                            <Phone className="absolute left-3 top-3.5 h-5 w-5 text-slate-400" />
                            <Input
                                name="phone"
                                value={settings.phone}
                                onChange={handleInputChange}
                                className="pl-10 h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-2">Website</label>
                        <div className="relative">
                            <Globe className="absolute left-3 top-3.5 h-5 w-5 text-slate-400" />
                            <Input
                                name="website"
                                value={settings.website}
                                onChange={handleInputChange}
                                className="pl-10 h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800"
                            />
                        </div>
                    </div>
                </div>

                {/* Right Column: Address and File uploads */}
                <div className="space-y-4">
                    <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-2">Company Address</label>
                        <div className="relative">
                            <MapPin className="absolute left-3 top-3 h-5 w-5 text-slate-400" />
                            <Textarea
                                name="address"
                                value={settings.address}
                                onChange={handleInputChange}
                                className="pl-10 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 h-28 resize-none"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                        <div className="grid grid-cols-2 gap-4">
                            {/* Logo Upload */}
                            <div className="p-4 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 flex flex-col items-center justify-center text-center">
                                <FileImage className="h-6 w-6 text-slate-400 mb-2" />
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Company Logo</span>
                                {settings.logo ? (
                                    <div className="relative mb-2 w-16 h-16 rounded border border-slate-100 dark:border-slate-800 overflow-hidden flex items-center justify-center bg-white">
                                        <img src={settings.logo} alt="Logo Preview" className="max-w-full max-h-full object-contain" />
                                        <button
                                            type="button"
                                            onClick={() => setSettings(prev => ({ ...prev, logo: "" }))}
                                            className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 text-[8px] w-4 h-4 flex items-center justify-center font-bold"
                                        >
                                            ×
                                        </button>
                                    </div>
                                ) : (
                                    <label className="cursor-pointer bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50">
                                        Upload
                                        <input type="file" accept="image/png,image/jpeg" onChange={(e) => handleFileChange(e, "logo")} className="hidden" />
                                    </label>
                                )}
                            </div>

                            {/* Signature Upload */}
                            <div className="p-4 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 flex flex-col items-center justify-center text-center">
                                <Signature className="h-6 w-6 text-slate-400 mb-2" />
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">HR Signature</span>
                                {settings.signature ? (
                                    <div className="relative mb-2 w-16 h-16 rounded border border-slate-100 dark:border-slate-800 overflow-hidden flex items-center justify-center bg-white">
                                        <img src={settings.signature} alt="Signature Preview" className="max-w-full max-h-full object-contain" />
                                        <button
                                            type="button"
                                            onClick={() => setSettings(prev => ({ ...prev, signature: "" }))}
                                            className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 text-[8px] w-4 h-4 flex items-center justify-center font-bold"
                                        >
                                            ×
                                        </button>
                                    </div>
                                ) : (
                                    <label className="cursor-pointer bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50">
                                        Upload
                                        <input type="file" accept="image/png,image/jpeg" onChange={(e) => handleFileChange(e, "signature")} className="hidden" />
                                    </label>
                                )}
                            </div>
                        </div>

                        {/* Letterhead Upload */}
                        <div className="p-4 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 flex flex-col items-center justify-center text-center">
                            <FileImage className="h-6 w-6 text-slate-400 mb-2" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">Letterhead Template</span>
                            {settings.letterhead ? (
                                <div className="relative mb-2 w-full h-24 rounded border border-slate-100 dark:border-slate-800 overflow-hidden flex items-center justify-center bg-white">
                                    <img src={settings.letterhead} alt="Letterhead Preview" className="max-w-full max-h-full object-contain" />
                                    <button
                                        type="button"
                                        onClick={() => setSettings(prev => ({ ...prev, letterhead: "" }))}
                                        className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 text-[10px] w-5 h-5 flex items-center justify-center font-bold z-10"
                                    >
                                        ×
                                    </button>
                                </div>
                            ) : (
                                <label className="cursor-pointer bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50">
                                    Upload Letterhead
                                    <input type="file" accept="image/png,image/jpeg" onChange={(e) => handleFileChange(e, "letterhead")} className="hidden" />
                                </label>
                            )}
                            <p className="text-[9px] text-slate-400 mt-2 max-w-[250px]">A4 ratio image (210x297) under 500KB. Will be used as background for generated letters.</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800">
                <Button type="submit" disabled={isSubmitting} className="h-12 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase text-xs tracking-widest shadow-xl shadow-indigo-600/20 transition-all flex items-center gap-2">
                    {isSubmitting ? (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Updating...
                        </>
                    ) : (
                        <>
                            <Save className="h-4 w-4" />
                            Save Company Settings
                        </>
                    )}
                </Button>
            </div>
        </form>
    );
}
