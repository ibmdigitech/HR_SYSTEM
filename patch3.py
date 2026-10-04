import re

with open('app/employees/employee-list.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# ─── 1. Replace state hooks: add all 9 doc draft states ───
old_state = '''    const [passportDocDraft, setPassportDocDraft] = useState("");
    const [emiratesDocDraft, setEmiratesDocDraft] = useState("");
    const [visaDocDraft, setVisaDocDraft] = useState("");
    const [addressDocDraft, setAddressDocDraft] = useState("");

    const handleDocFile = async (file: File | undefined, setter: (val: string) => void) => {
        if (!file) {
            setter("");
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => setter(e.target?.result as string);
        reader.readAsDataURL(file);
    };'''

new_state = '''    const [passportDocDraft, setPassportDocDraft] = useState("");
    const [emiratesDocDraft, setEmiratesDocDraft] = useState("");
    const [visaDocDraft, setVisaDocDraft] = useState("");
    const [addressDocDraft, setAddressDocDraft] = useState("");
    const [ibanDocDraft, setIbanDocDraft] = useState("");
    const [medicalDocDraft, setMedicalDocDraft] = useState("");
    const [iloeDocDraft, setIloeDocDraft] = useState("");
    const [labourDocDraft, setLabourDocDraft] = useState("");
    const [residenceDocDraft, setResidenceDocDraft] = useState("");

    const handleDocFile = async (file: File | undefined, setter: (val: string) => void) => {
        if (!file) {
            setter("");
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => setter(e.target?.result as string);
        reader.readAsDataURL(file);
    };'''
content = content.replace(old_state, new_state)

# ─── 2. Replace entire submit change-detection logic ───
old_submit = '''        const passportChanged = selectedEmployee?.id ? (
            (formData.get("passportNumber") as string || "").trim() !== (selectedEmployee.passportNumber || "").trim() ||
            (formData.get("passportExpiry") as string || "").trim() !== (selectedEmployee.passportExpiry ? new Date(selectedEmployee.passportExpiry).toISOString().split('T')[0] : "").trim()
        ) : false;

        const emiratesChanged = selectedEmployee?.id ? (
            (formData.get("emiratesId") as string || "").trim() !== (selectedEmployee.emiratesId || "").trim() ||
            (formData.get("emiratesIdExpiry") as string || "").trim() !== (selectedEmployee.emiratesIdExpiry ? new Date(selectedEmployee.emiratesIdExpiry).toISOString().split('T')[0] : "").trim()
        ) : false;

        const visaChanged = selectedEmployee?.id ? (
            (formData.get("visaNumber") as string || "").trim() !== (selectedEmployee.visaNumber || "").trim() ||
            (formData.get("visaExpiry") as string || "").trim() !== (selectedEmployee.visaExpiry ? new Date(selectedEmployee.visaExpiry).toISOString().split('T')[0] : "").trim()
        ) : false;

        const addressChanged = selectedEmployee?.id ? (
            (formData.get("address") as string || "").trim() !== (selectedEmployee.address || "").trim() ||
            (formData.get("permanentAddress") as string || "").trim() !== (selectedEmployee.permanentAddress || "").trim()
        ) : false;

        const missingDocs = [];
        if (passportChanged && !passportDocDraft) missingDocs.push("Passport");
        if (emiratesChanged && !emiratesDocDraft) missingDocs.push("Emirates ID");
        if (visaChanged && !visaDocDraft) missingDocs.push("Visa");
        if (addressChanged && !addressDocDraft) missingDocs.push("Address");

        if (missingDocs.length > 0) {
            toast.error(`Please upload supporting documents for: ${missingDocs.join(", ")}`);
            if (addressChanged && !addressDocDraft) setActiveTab("personal");
            else setActiveTab("docs");
            return;
        }

        if (passportChanged || emiratesChanged || visaChanged || addressChanged) {
            const changes: Record<string, any> = {};
            for (const [key, value] of formData.entries()) {
                if (typeof value === "string" && key !== "id" && key !== "changeRequestDocument") {
                    changes[key] = value;
                }
            }
            
            const documents = [];
            if (passportChanged && passportDocDraft) documents.push({ documentType: "PASSPORT", documentUrl: passportDocDraft });
            if (emiratesChanged && emiratesDocDraft) documents.push({ documentType: "EMIRATES_ID", documentUrl: emiratesDocDraft });
            if (visaChanged && visaDocDraft) documents.push({ documentType: "VISA", documentUrl: visaDocDraft });
            if (addressChanged && addressDocDraft) documents.push({ documentType: "ADDRESS_PROOF", documentUrl: addressDocDraft });
            
            setIsSubmitting(true);
            try {
                const res = await submitChangeRequest({
                    employeeId: selectedEmployee!.id,
                    changes,
                    documents
                });
                if (res.success) {
                    toast.success("Change request submitted for approval.");
                    setOpen(false);
                    setTimeout(() => window.location.reload(), 1500);
                } else {
                    toast.error(res.message);
                }
            } catch (e) {
                toast.error("Error submitting change request");
            } finally {
                setIsSubmitting(false);
            }
            return;
        }'''

new_submit = '''        // ── Per-section change detection ──
        const strField = (name: string) => (formData.get(name) as string || "").trim();
        const oldStr = (val: any) => (val ? String(val) : "").trim();
        const oldDate = (val: any) => val ? new Date(val).toISOString().split("T")[0] : "";

        const passportChanged = selectedEmployee?.id ? (strField("passportNumber") !== oldStr(selectedEmployee.passportNumber) || strField("passportExpiry") !== oldDate(selectedEmployee.passportExpiry)) : false;
        const emiratesChanged = selectedEmployee?.id ? (strField("emiratesId") !== oldStr(selectedEmployee.emiratesId) || strField("emiratesIdExpiry") !== oldDate(selectedEmployee.emiratesIdExpiry)) : false;
        const visaChanged = selectedEmployee?.id ? (strField("visaNumber") !== oldStr(selectedEmployee.visaNumber) || strField("visaExpiry") !== oldDate(selectedEmployee.visaExpiry)) : false;
        const addressChanged = selectedEmployee?.id ? (strField("address") !== oldStr(selectedEmployee.address) || strField("permanentAddress") !== oldStr(selectedEmployee.permanentAddress)) : false;
        const ibanChanged = selectedEmployee?.id ? (strField("iban") !== oldStr(selectedEmployee.iban) || strField("bankName") !== oldStr(selectedEmployee.bankName) || strField("accountNumber") !== oldStr(selectedEmployee.accountNumber)) : false;
        const medicalChanged = selectedEmployee?.id ? (strField("medicalInsuranceExpiry") !== oldDate(selectedEmployee.medicalInsuranceExpiry)) : false;
        const iloeChanged = selectedEmployee?.id ? (strField("iloeInsuranceExpiry") !== oldDate((selectedEmployee as any).iloeInsuranceExpiry)) : false;
        const labourChanged = selectedEmployee?.id ? (strField("labourCardNumber") !== oldStr((selectedEmployee as any).labourCardNumber) || strField("labourCardExpiry") !== oldDate((selectedEmployee as any).labourCardExpiry)) : false;
        const residenceChanged = selectedEmployee?.id ? (strField("residencePermitNumber") !== oldStr((selectedEmployee as any).residencePermitNumber) || strField("residencePermitExpiry") !== oldDate((selectedEmployee as any).residencePermitExpiry)) : false;

        const missingDocs: string[] = [];
        if (passportChanged && !passportDocDraft) missingDocs.push("Passport");
        if (emiratesChanged && !emiratesDocDraft) missingDocs.push("Emirates ID");
        if (visaChanged && !visaDocDraft) missingDocs.push("Visa");
        if (addressChanged && !addressDocDraft) missingDocs.push("Address Proof");
        if (ibanChanged && !ibanDocDraft) missingDocs.push("IBAN / Bank");
        if (medicalChanged && !medicalDocDraft) missingDocs.push("Medical Insurance");
        if (iloeChanged && !iloeDocDraft) missingDocs.push("ILOE Insurance");
        if (labourChanged && !labourDocDraft) missingDocs.push("Labour Card");
        if (residenceChanged && !residenceDocDraft) missingDocs.push("Residence Permit");

        if (missingDocs.length > 0) {
            toast.error(`Please upload supporting documents for: ${missingDocs.join(", ")}`);
            if (ibanChanged && !ibanDocDraft) setActiveTab("finance");
            else if (addressChanged && !addressDocDraft) setActiveTab("personal");
            else setActiveTab("docs");
            return;
        }

        const anySensitive = passportChanged || emiratesChanged || visaChanged || addressChanged || ibanChanged || medicalChanged || iloeChanged || labourChanged || residenceChanged;
        if (anySensitive) {
            const changes: Record<string, any> = {};
            for (const [key, value] of formData.entries()) {
                if (typeof value === "string" && key !== "id" && key !== "changeRequestDocument") {
                    changes[key] = value;
                }
            }
            
            const documents: { documentType: string; documentUrl: string }[] = [];
            if (passportChanged && passportDocDraft) documents.push({ documentType: "PASSPORT", documentUrl: passportDocDraft });
            if (emiratesChanged && emiratesDocDraft) documents.push({ documentType: "EMIRATES_ID", documentUrl: emiratesDocDraft });
            if (visaChanged && visaDocDraft) documents.push({ documentType: "VISA", documentUrl: visaDocDraft });
            if (addressChanged && addressDocDraft) documents.push({ documentType: "ADDRESS_PROOF", documentUrl: addressDocDraft });
            if (ibanChanged && ibanDocDraft) documents.push({ documentType: "BANK_IBAN", documentUrl: ibanDocDraft });
            if (medicalChanged && medicalDocDraft) documents.push({ documentType: "MEDICAL_INSURANCE", documentUrl: medicalDocDraft });
            if (iloeChanged && iloeDocDraft) documents.push({ documentType: "ILOE_INSURANCE", documentUrl: iloeDocDraft });
            if (labourChanged && labourDocDraft) documents.push({ documentType: "LABOUR_CARD", documentUrl: labourDocDraft });
            if (residenceChanged && residenceDocDraft) documents.push({ documentType: "RESIDENCE_PERMIT", documentUrl: residenceDocDraft });
            
            setIsSubmitting(true);
            try {
                const res = await submitChangeRequest({
                    employeeId: selectedEmployee!.id,
                    changes,
                    documents
                });
                if (res.success) {
                    toast.success("Change request submitted for approval.");
                    setOpen(false);
                    setTimeout(() => window.location.reload(), 1500);
                } else {
                    toast.error(res.message);
                }
            } catch (e) {
                toast.error("Error submitting change request");
            } finally {
                setIsSubmitting(false);
            }
            return;
        }'''
content = content.replace(old_submit, new_submit)

# ─── 3. Add renderDocUpload helper function (if not already present) ───
if 'renderDocUpload' not in content:
    helper = '''    const renderDocUpload = (id: string, label: string, draft: string, setter: (val: string) => void) => (
        <div className="mt-3 p-3 border border-indigo-100 bg-indigo-50/50 dark:border-indigo-900/50 dark:bg-indigo-950/20 rounded-xl">
            <div className="flex items-center gap-2 mb-1.5">
                <Upload className="h-3.5 w-3.5 text-indigo-500" />
                <Label className="text-[10px] font-bold uppercase text-indigo-600 tracking-[0.1em] dark:text-indigo-400">Upload {label} Document</Label>
            </div>
            <p className="text-[10px] font-medium text-indigo-700/70 dark:text-indigo-300/70 mb-2">Required when updating these fields</p>
            {draft ? (
                <div className="flex items-center justify-between bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-800">
                    <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        <span className="text-[11px] font-semibold text-emerald-600">Document attached</span>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setter("")} className="h-6 text-[10px] text-rose-500 hover:text-rose-600 hover:bg-rose-50 ml-2 px-2">Remove</Button>
                </div>
            ) : (
                <div className="flex items-center gap-2">
                    <input id={`upload-${id}`} type="file" className="sr-only" accept="image/*,.pdf,.doc,.docx" onChange={(e) => { handleDocFile(e.target.files?.[0], setter); e.target.value = ""; }} />
                    <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg font-bold border-indigo-200 hover:bg-indigo-100 text-indigo-700 text-[10px] gap-1.5 transition-colors" onClick={() => document.getElementById(`upload-${id}`)?.click()}>
                        <Upload className="h-3 w-3" /> Attach File
                    </Button>
                </div>
            )}
        </div>
    );

    return ('''
    content = content.replace('    return (\n        <Dialog', helper + '\n        <Dialog')

# ─── 4. Add new fields to fieldToTab mapping ───
old_map_end = '''        iloeInsuranceExpiry: "docs",
    };'''
new_map_end = '''        iloeInsuranceExpiry: "docs",
        labourCardNumber: "docs",
        labourCardExpiry: "docs",
        residencePermitNumber: "docs",
        residencePermitExpiry: "docs",
    };'''
content = content.replace(old_map_end, new_map_end)

# ─── 5. Add new fields to docs section required fields ───
old_docs_fields = '''                return ["governmentId", "currentStatus", "passportNumber", "passportExpiry", "emiratesId", "emiratesIdExpiry", "visaNumber", "visaExpiry", "medicalInsuranceExpiry"];'''
new_docs_fields = '''                return ["governmentId", "currentStatus", "passportNumber", "passportExpiry", "emiratesId", "emiratesIdExpiry", "visaNumber", "visaExpiry", "medicalInsuranceExpiry", "iloeInsuranceExpiry", "labourCardNumber", "labourCardExpiry", "residencePermitNumber", "residencePermitExpiry"];'''
content = content.replace(old_docs_fields, new_docs_fields)

# ─── 6. Replace the entire docs TabsContent with new grouped sections + inline uploads ───
# Find the docs tab content and replace it entirely
old_docs_tab = '''                                            <TabsContent value="docs" forceMount className="m-0 space-y-8 data-[state=inactive]:hidden">
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                                    <div className="space-y-3">
                                                        <Label className="text-xs font-bold uppercase text-slate-600 tracking-[0.1em] ml-1 dark:text-slate-300">Government ID</Label>
                                                        <Input name="governmentId" defaultValue={selectedEmployee?.governmentId} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-xs font-bold uppercase text-slate-600 tracking-[0.1em] ml-1 dark:text-slate-300">Current Status</Label>
                                                        <Select name="currentStatus" defaultValue={selectedEmployee?.currentStatus || "ACTIVE"}>
                                                            <SelectTrigger className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="PRE_JOINING">Pre-joining</SelectItem>
                                                                <SelectItem value="ACTIVE">Active</SelectItem>
                                                                <SelectItem value="ON_LEAVE">On Leave</SelectItem>
                                                                <SelectItem value="RESIGNED">Resigned</SelectItem>
                                                                <SelectItem value="TERMINATED">Terminated</SelectItem>
                                                                <SelectItem value="OFFBOARDED">Offboarded</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                    {/* Documents are grouped as a pair \u2014 number
                                                        alongside its expiry \u2014 so the relationship
                                                        is obvious at a glance and each expiry
                                                        carries its own relative status. */}
                                                    <div className="col-span-2 space-y-5">
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                            <div className="space-y-3">
                                                                <Label className="text-xs font-bold uppercase text-slate-600 tracking-[0.1em] ml-1 dark:text-slate-300">Passport Number</Label>
                                                                <Input name="passportNumber" defaultValue={selectedEmployee?.passportNumber} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                            </div>
                                                            <DateField
                                                                name="passportExpiry"
                                                                label="Passport Expiry"
                                                                defaultValue={selectedEmployee?.passportExpiry}
                                                                expiry
                                                                minDate={new Date()}
                                                                hint="Must be a valid future date"
                                                                error={fieldErrors.passportExpiry}
                                                            />
                                                        </div>

                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                            <div className="space-y-3">
                                                                <Label className="text-xs font-bold uppercase text-slate-600 tracking-[0.1em] ml-1 dark:text-slate-300">Emirates ID</Label>
                                                                <Input name="emiratesId" defaultValue={selectedEmployee?.emiratesId} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                            </div>
                                                            <DateField
                                                                name="emiratesIdExpiry"
                                                                label="Emirates ID Expiry"
                                                                defaultValue={selectedEmployee?.emiratesIdExpiry}
                                                                expiry
                                                                minDate={new Date()}
                                                                hint="Must be a valid future date"
                                                                error={fieldErrors.emiratesIdExpiry}
                                                            />
                                                        </div>

                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                            <div className="space-y-3">
                                                                <Label className="text-xs font-bold uppercase text-slate-600 tracking-[0.1em] ml-1 dark:text-slate-300">Visa Number</Label>
                                                                <Input name="visaNumber" defaultValue={selectedEmployee?.visaNumber} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                            </div>
                                                            <DateField
                                                                name="visaExpiry"
                                                                label="Visa Expiry"
                                                                defaultValue={selectedEmployee?.visaExpiry}
                                                                expiry
                                                                minDate={new Date()}
                                                                hint="Must be a valid future date"
                                                                error={fieldErrors.visaExpiry}
                                                            />
                                                        </div>

                                                        <DateField
                                                            name="medicalInsuranceExpiry"
                                                            label="Medical Insurance Expiry"
                                                            defaultValue={selectedEmployee?.medicalInsuranceExpiry}
                                                            expiry
                                                            minDate={new Date()}
                                                            hint="Must be a valid future date"
                                                            error={fieldErrors.medicalInsuranceExpiry}
                                                        />
                                                    </div>


                                                </div>
                                            </TabsContent>'''

new_docs_tab = '''                                            <TabsContent value="docs" forceMount className="m-0 space-y-6 data-[state=inactive]:hidden">
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                                    <div className="space-y-3">
                                                        <Label className="text-xs font-bold uppercase text-slate-600 tracking-[0.1em] ml-1 dark:text-slate-300">Government ID</Label>
                                                        <Input name="governmentId" defaultValue={selectedEmployee?.governmentId} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                    </div>
                                                    <div className="space-y-3">
                                                        <Label className="text-xs font-bold uppercase text-slate-600 tracking-[0.1em] ml-1 dark:text-slate-300">Current Status</Label>
                                                        <Select name="currentStatus" defaultValue={selectedEmployee?.currentStatus || "ACTIVE"}>
                                                            <SelectTrigger className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="PRE_JOINING">Pre-joining</SelectItem>
                                                                <SelectItem value="ACTIVE">Active</SelectItem>
                                                                <SelectItem value="ON_LEAVE">On Leave</SelectItem>
                                                                <SelectItem value="RESIGNED">Resigned</SelectItem>
                                                                <SelectItem value="TERMINATED">Terminated</SelectItem>
                                                                <SelectItem value="OFFBOARDED">Offboarded</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                </div>

                                                {/* ── Passport Section ── */}
                                                <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-900/30">
                                                    <div className="flex items-center gap-2 mb-4">
                                                        <ShieldCheck className="h-4 w-4 text-blue-600" />
                                                        <h4 className="text-xs font-black uppercase tracking-[0.15em] text-slate-700 dark:text-slate-200">Passport</h4>
                                                    </div>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                        <div className="space-y-1.5">
                                                            <Label className="text-xs font-bold uppercase text-slate-600 tracking-[0.1em] ml-1 dark:text-slate-300">Passport Number</Label>
                                                            <Input name="passportNumber" defaultValue={selectedEmployee?.passportNumber} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                        </div>
                                                        <DateField name="passportExpiry" label="Passport Expiry" defaultValue={selectedEmployee?.passportExpiry} expiry minDate={new Date()} hint="Must be a valid future date" error={fieldErrors.passportExpiry} />
                                                    </div>
                                                    {selectedEmployee?.id && renderDocUpload("passport", "Passport", passportDocDraft, setPassportDocDraft)}
                                                </div>

                                                {/* ── Emirates ID Section ── */}
                                                <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-900/30">
                                                    <div className="flex items-center gap-2 mb-4">
                                                        <CreditCard className="h-4 w-4 text-emerald-600" />
                                                        <h4 className="text-xs font-black uppercase tracking-[0.15em] text-slate-700 dark:text-slate-200">Emirates ID</h4>
                                                    </div>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                        <div className="space-y-1.5">
                                                            <Label className="text-xs font-bold uppercase text-slate-600 tracking-[0.1em] ml-1 dark:text-slate-300">Emirates ID</Label>
                                                            <Input name="emiratesId" defaultValue={selectedEmployee?.emiratesId} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                        </div>
                                                        <DateField name="emiratesIdExpiry" label="Emirates ID Expiry" defaultValue={selectedEmployee?.emiratesIdExpiry} expiry minDate={new Date()} hint="Must be a valid future date" error={fieldErrors.emiratesIdExpiry} />
                                                    </div>
                                                    {selectedEmployee?.id && renderDocUpload("emirates", "Emirates ID", emiratesDocDraft, setEmiratesDocDraft)}
                                                </div>

                                                {/* ── Visa Section ── */}
                                                <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-900/30">
                                                    <div className="flex items-center gap-2 mb-4">
                                                        <Briefcase className="h-4 w-4 text-violet-600" />
                                                        <h4 className="text-xs font-black uppercase tracking-[0.15em] text-slate-700 dark:text-slate-200">Visa</h4>
                                                    </div>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                        <div className="space-y-1.5">
                                                            <Label className="text-xs font-bold uppercase text-slate-600 tracking-[0.1em] ml-1 dark:text-slate-300">Visa Number</Label>
                                                            <Input name="visaNumber" defaultValue={selectedEmployee?.visaNumber} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                        </div>
                                                        <DateField name="visaExpiry" label="Visa Expiry" defaultValue={selectedEmployee?.visaExpiry} expiry minDate={new Date()} hint="Must be a valid future date" error={fieldErrors.visaExpiry} />
                                                    </div>
                                                    {selectedEmployee?.id && renderDocUpload("visa", "Visa", visaDocDraft, setVisaDocDraft)}
                                                </div>

                                                {/* ── Residence Permit Section ── */}
                                                <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-900/30">
                                                    <div className="flex items-center gap-2 mb-4">
                                                        <MapPin className="h-4 w-4 text-amber-600" />
                                                        <h4 className="text-xs font-black uppercase tracking-[0.15em] text-slate-700 dark:text-slate-200">Residence Permit</h4>
                                                    </div>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                        <div className="space-y-1.5">
                                                            <Label className="text-xs font-bold uppercase text-slate-600 tracking-[0.1em] ml-1 dark:text-slate-300">Residence Permit No.</Label>
                                                            <Input name="residencePermitNumber" defaultValue={(selectedEmployee as any)?.residencePermitNumber} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                        </div>
                                                        <DateField name="residencePermitExpiry" label="Residence Permit Expiry" defaultValue={(selectedEmployee as any)?.residencePermitExpiry} expiry minDate={new Date()} hint="Must be a valid future date" error={fieldErrors.residencePermitExpiry} />
                                                    </div>
                                                    {selectedEmployee?.id && renderDocUpload("residence", "Residence Permit", residenceDocDraft, setResidenceDocDraft)}
                                                </div>

                                                {/* ── Labour Card Section ── */}
                                                <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-900/30">
                                                    <div className="flex items-center gap-2 mb-4">
                                                        <ClipboardCheck className="h-4 w-4 text-cyan-600" />
                                                        <h4 className="text-xs font-black uppercase tracking-[0.15em] text-slate-700 dark:text-slate-200">Labour Card</h4>
                                                    </div>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                        <div className="space-y-1.5">
                                                            <Label className="text-xs font-bold uppercase text-slate-600 tracking-[0.1em] ml-1 dark:text-slate-300">Labour Card No.</Label>
                                                            <Input name="labourCardNumber" defaultValue={(selectedEmployee as any)?.labourCardNumber} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
                                                        </div>
                                                        <DateField name="labourCardExpiry" label="Labour Card Expiry" defaultValue={(selectedEmployee as any)?.labourCardExpiry} expiry minDate={new Date()} hint="Must be a valid future date" error={fieldErrors.labourCardExpiry} />
                                                    </div>
                                                    {selectedEmployee?.id && renderDocUpload("labour", "Labour Card", labourDocDraft, setLabourDocDraft)}
                                                </div>

                                                {/* ── Medical Insurance Section ── */}
                                                <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-900/30">
                                                    <div className="flex items-center gap-2 mb-4">
                                                        <Activity className="h-4 w-4 text-rose-600" />
                                                        <h4 className="text-xs font-black uppercase tracking-[0.15em] text-slate-700 dark:text-slate-200">Medical Insurance</h4>
                                                    </div>
                                                    <DateField name="medicalInsuranceExpiry" label="Medical Insurance Expiry" defaultValue={selectedEmployee?.medicalInsuranceExpiry} expiry minDate={new Date()} hint="Must be a valid future date" error={fieldErrors.medicalInsuranceExpiry} />
                                                    {selectedEmployee?.id && renderDocUpload("medical", "Medical Insurance", medicalDocDraft, setMedicalDocDraft)}
                                                </div>

                                                {/* ── ILOE Insurance Section ── */}
                                                <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-900/30">
                                                    <div className="flex items-center gap-2 mb-4">
                                                        <ShieldCheck className="h-4 w-4 text-teal-600" />
                                                        <h4 className="text-xs font-black uppercase tracking-[0.15em] text-slate-700 dark:text-slate-200">ILOE Insurance</h4>
                                                    </div>
                                                    <DateField name="iloeInsuranceExpiry" label="ILOE Insurance Expiry" defaultValue={(selectedEmployee as any)?.iloeInsuranceExpiry} expiry minDate={new Date()} hint="Must be a valid future date" error={fieldErrors.iloeInsuranceExpiry} />
                                                    {selectedEmployee?.id && renderDocUpload("iloe", "ILOE Insurance", iloeDocDraft, setIloeDocDraft)}
                                                </div>
                                            </TabsContent>'''
content = content.replace(old_docs_tab, new_docs_tab)

# ─── 7. Add IBAN/Bank upload area to finance tab ───
old_finance_end = '''                                                    <div className="space-y-3">
                                                        <Label className="text-xs font-bold uppercase text-slate-600 tracking-[0.1em] ml-1 dark:text-slate-300">IBAN</Label>
                                                        <Input name="iban" id="emp-iban" aria-invalid={fieldErrors.iban ? "true" : undefined} aria-describedby={fieldErrors.iban ? "emp-iban-error" : undefined} defaultValue={selectedEmployee?.iban} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
<FieldError id="emp-iban" error={fieldErrors.iban} />
                                                    </div>
                                                </div>
                                            </TabsContent>'''

new_finance_end = '''                                                    <div className="space-y-3">
                                                        <Label className="text-xs font-bold uppercase text-slate-600 tracking-[0.1em] ml-1 dark:text-slate-300">IBAN</Label>
                                                        <Input name="iban" id="emp-iban" aria-invalid={fieldErrors.iban ? "true" : undefined} aria-describedby={fieldErrors.iban ? "emp-iban-error" : undefined} defaultValue={selectedEmployee?.iban} className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold" />
<FieldError id="emp-iban" error={fieldErrors.iban} />
                                                    </div>
                                                    {selectedEmployee?.id && (
                                                        <div className="col-span-2">
                                                            {renderDocUpload("iban", "IBAN / Bank Details", ibanDocDraft, setIbanDocDraft)}
                                                        </div>
                                                    )}
                                                </div>
                                            </TabsContent>'''
content = content.replace(old_finance_end, new_finance_end)

# ─── 8. Add Address upload area to personal tab ───
# Find the permanent address block and add upload after it
old_addr = '''                                                        <div className="sm:col-span-2 space-y-3">
                                                            <Label className="text-xs font-bold uppercase text-slate-600 tracking-[0.1em] ml-1 dark:text-slate-300">Home / Permanent Address</Label>
                                                            <textarea name="permanentAddress" defaultValue={selectedEmployee?.permanentAddress ?? ""} placeholder="House or apartment, street, city, country" rows={3} className="w-full min-h-16 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-3 font-bold text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" />
                                                        </div>
                                                    </div>
                                                </div>'''

new_addr = '''                                                        <div className="sm:col-span-2 space-y-3">
                                                            <Label className="text-xs font-bold uppercase text-slate-600 tracking-[0.1em] ml-1 dark:text-slate-300">Home / Permanent Address</Label>
                                                            <textarea name="permanentAddress" defaultValue={selectedEmployee?.permanentAddress ?? ""} placeholder="House or apartment, street, city, country" rows={3} className="w-full min-h-16 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-3 font-bold text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" />
                                                        </div>
                                                        {selectedEmployee?.id && (
                                                            <div className="sm:col-span-2">
                                                                {renderDocUpload("address", "Address Proof", addressDocDraft, setAddressDocDraft)}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>'''
content = content.replace(old_addr, new_addr)

with open('app/employees/employee-list.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("DONE - Full patch applied successfully")
