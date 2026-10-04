import re

with open('app/employees/employee-list.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. State hooks
old_state = '''    const [changeDocDraft, setChangeDocDraft] = useState("");
    const handleChangeDocFile = async (file?: File) => {
        if (!file) {
            setChangeDocDraft("");
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => setChangeDocDraft(e.target?.result as string);
        reader.readAsDataURL(file);
    };'''

new_state = '''    const [passportDocDraft, setPassportDocDraft] = useState("");
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
content = content.replace(old_state, new_state)


# 2. handleSubmit
old_submit = '''        const SENSITIVE_FIELDS = ["passportNumber", "passportExpiry", "emiratesId", "emiratesIdExpiry", "visaNumber", "visaExpiry", "address", "permanentAddress"];
        let sensitiveChanged = false;
        if (selectedEmployee?.id) {
            for (const field of SENSITIVE_FIELDS) {
                const newVal = (formData.get(field) as string || "").trim();
                let oldVal = selectedEmployee[field as keyof typeof selectedEmployee];
                if (oldVal instanceof Date) oldVal = oldVal.toISOString().split('T')[0];
                const oldValStr = (oldVal ? String(oldVal) : "").trim();
                if (newVal !== oldValStr && newVal !== "") {
                    sensitiveChanged = true;
                }
            }
        }
        
        if (sensitiveChanged) {
            if (!changeDocDraft) {
                toast.error("You have modified sensitive fields. Please upload a supporting document in the Documents tab.");
                setActiveTab("docs");
                return;
            }
            
            const changes: Record<string, any> = {};
            for (const [key, value] of formData.entries()) {
                if (typeof value === "string" && key !== "id" && key !== "changeRequestDocument") {
                    changes[key] = value;
                }
            }
            
            setIsSubmitting(true);
            try {
                const res = await submitChangeRequest({
                    employeeId: selectedEmployee.id,
                    changes,
                    documents: [{ documentType: "SUPPORTING_DOC", documentUrl: changeDocDraft }]
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

new_submit = '''        const passportChanged = selectedEmployee?.id ? (
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
content = content.replace(old_submit, new_submit)


# 3. Add renderDocUpload helper
helper = '''    const renderDocUpload = (id: string, label: string, draft: string, setter: (val: string) => void) => (
        <div className="mt-3 p-3 border border-indigo-100 bg-indigo-50/50 dark:border-indigo-900/50 dark:bg-indigo-950/20 rounded-xl">
            <Label className="text-[10px] font-bold uppercase text-indigo-600 tracking-[0.1em] dark:text-indigo-400">Upload {label} Document</Label>
            <p className="text-[10px] font-medium text-indigo-700/70 dark:text-indigo-300/70 mb-2">Required if changing these fields.</p>
            {draft ? (
                <div className="flex items-center justify-between bg-white dark:bg-slate-900 p-2 rounded border border-indigo-200 dark:border-indigo-800">
                    <span className="text-[10px] font-semibold text-emerald-600 truncate flex-1">Ready</span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setter("")} className="h-6 text-[10px] text-rose-500 hover:text-rose-600 hover:bg-rose-50 ml-2 px-2">Remove</Button>
                </div>
            ) : (
                <div className="flex items-center gap-2">
                    <input id={`upload-${id}`} type="file" className="sr-only" onChange={(e) => { handleDocFile(e.target.files?.[0], setter); e.target.value = ""; }} />
                    <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg font-bold border-indigo-200 hover:bg-indigo-50 text-indigo-700 text-[10px]" onClick={() => document.getElementById(`upload-${id}`)?.click()}>
                        <Upload className="mr-1.5 h-3 w-3" /> Attach File
                    </Button>
                </div>
            )}
        </div>
    );

    return (
'''
content = content.replace('    return (\n        <Dialog', helper + '        <Dialog')

# 4. Inject into Address
addr_target = '''                                                            <div className="space-y-1.5 sm:col-span-2">
                                                                <Label className="text-xs font-bold uppercase text-slate-600 tracking-[0.1em] ml-1 dark:text-slate-300">Home / Permanent Address</Label>
                                                                <textarea name="permanentAddress" defaultValue={selectedEmployee?.permanentAddress ?? ""} placeholder="House or apartment, street, city, country" rows={3} className="w-full min-h-16 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-3 font-bold text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" />
                                                            </div>'''
addr_new = addr_target + '''
                                                            {selectedEmployee?.id && (
                                                                <div className="sm:col-span-2">
                                                                    {renderDocUpload('address', 'Address Proof', addressDocDraft, setAddressDocDraft)}
                                                                </div>
                                                            )}'''
content = content.replace(addr_target, addr_new)

# 5. Inject into Passport
pass_target = '''                                                            <div className="space-y-1.5">
                                                                <DateField
                                                                    name="passportExpiry"
                                                                    label="Passport Expiry"
                                                                    defaultValue={selectedEmployee?.passportExpiry}
                                                                    className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold"
                                                                    error={fieldErrors.passportExpiry}
                                                                />
                                                            </div>'''
pass_new = pass_target + '''
                                                            {selectedEmployee?.id && (
                                                                <div className="sm:col-span-2">
                                                                    {renderDocUpload('passport', 'Passport', passportDocDraft, setPassportDocDraft)}
                                                                </div>
                                                            )}'''
content = content.replace(pass_target, pass_new)

# 6. Inject into Emirates ID
emirates_target = '''                                                            <div className="space-y-1.5">
                                                                <DateField
                                                                    name="emiratesIdExpiry"
                                                                    label="Emirates ID Expiry"
                                                                    defaultValue={selectedEmployee?.emiratesIdExpiry}
                                                                    className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold"
                                                                    error={fieldErrors.emiratesIdExpiry}
                                                                />
                                                            </div>'''
emirates_new = emirates_target + '''
                                                            {selectedEmployee?.id && (
                                                                <div className="sm:col-span-2">
                                                                    {renderDocUpload('emirates', 'Emirates ID', emiratesDocDraft, setEmiratesDocDraft)}
                                                                </div>
                                                            )}'''
content = content.replace(emirates_target, emirates_new)

# 7. Inject into Visa
visa_target = '''                                                            <div className="space-y-1.5">
                                                                <DateField
                                                                    name="visaExpiry"
                                                                    label="Visa Expiry"
                                                                    defaultValue={selectedEmployee?.visaExpiry}
                                                                    className="h-12 rounded-xl bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 font-bold"
                                                                    error={fieldErrors.visaExpiry}
                                                                />
                                                            </div>'''
visa_new = visa_target + '''
                                                            {selectedEmployee?.id && (
                                                                <div className="sm:col-span-2">
                                                                    {renderDocUpload('visa', 'Visa', visaDocDraft, setVisaDocDraft)}
                                                                </div>
                                                            )}'''
content = content.replace(visa_target, visa_new)

# 8. Remove the old combined Change Request Document block
combined_block = '''                                                    <div className="col-span-2 space-y-3 mt-4 p-4 border border-indigo-100 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/30 rounded-xl">
                                                        <Label className="text-xs font-bold uppercase text-indigo-600 tracking-[0.1em] ml-1 dark:text-indigo-400">Change Request Document</Label>
                                                        <p className="text-[11px] font-medium text-indigo-700 dark:text-indigo-300">Required if updating sensitive fields (Passport, Visa, Emirates ID, Address)</p>
                                                        
                                                        {changeDocDraft ? (
                                                            <div className="flex items-center justify-between bg-white dark:bg-slate-900 p-3 rounded-lg border border-indigo-200 dark:border-indigo-800">
                                                                <span className="text-xs font-semibold text-emerald-600 truncate flex-1">Document ready for submission</span>
                                                                <Button type="button" variant="ghost" size="sm" onClick={() => setChangeDocDraft("")} className="text-rose-500 hover:text-rose-600 hover:bg-rose-50 ml-2">Remove</Button>
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-3">
                                                                <input
                                                                    id="change-doc-file"
                                                                    type="file"
                                                                    className="sr-only"
                                                                    onChange={(e) => {
                                                                        handleChangeDocFile(e.target.files?.[0]);
                                                                        e.target.value = "";
                                                                    }}
                                                                />
                                                                <Button
                                                                    type="button"
                                                                    variant="outline"
                                                                    className="h-10 rounded-xl font-bold border-indigo-200 hover:bg-indigo-50 text-indigo-700"
                                                                    onClick={() => document.getElementById("change-doc-file")?.click()}
                                                                >
                                                                    <Upload className="mr-2 h-4 w-4" />
                                                                    Upload Document
                                                                </Button>
                                                            </div>
                                                        )}
                                                    </div>'''

content = content.replace(combined_block, "")

with open('app/employees/employee-list.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Patch applied")
