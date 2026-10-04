import sys

content = open('app/employees/employee-list.tsx', 'r', encoding='utf-8').read()

import_patch = '''import { upsertEmployee, deleteEmployee } from "@/app/lib/actions/employees";
import { submitChangeRequest } from "@/app/lib/actions/change-requests";'''
content = content.replace('import { upsertEmployee, deleteEmployee } from "@/app/lib/actions/employees";', import_patch)

hook_patch = '''    const photoPreview = normalizeEmployeePhotoValue(photoDraft) ?? "";

    const [changeDocDraft, setChangeDocDraft] = useState("");
    const handleChangeDocFile = async (file?: File) => {
        if (!file) {
            setChangeDocDraft("");
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => setChangeDocDraft(e.target?.result as string);
        reader.readAsDataURL(file);
    };

    const handlePhotoFile = async (file?: File) => {'''
content = content.replace('    const photoPreview = normalizeEmployeePhotoValue(photoDraft) ?? "";\n\n    const handlePhotoFile = async (file?: File) => {', hook_patch)
content = content.replace('    const photoPreview = normalizeEmployeePhotoValue(photoDraft) ?? "";\r\n\r\n    const handlePhotoFile = async (file?: File) => {', hook_patch)

handle_submit_patch = '''    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (isSubmitting) return;

        const form = e.currentTarget;
        const formData = new FormData(form);
        
        const SENSITIVE_FIELDS = ["passportNumber", "passportExpiry", "emiratesId", "emiratesIdExpiry", "visaNumber", "visaExpiry", "address", "permanentAddress"];
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
        }

        // Immediate client-side pass.'''
        
content = content.replace('    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {\n        e.preventDefault();\n        if (isSubmitting) return;\n\n        const form = e.currentTarget;\n        const formData = new FormData(form);\n\n        // Immediate client-side pass.', handle_submit_patch)
content = content.replace('    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {\r\n        e.preventDefault();\r\n        if (isSubmitting) return;\r\n\r\n        const form = e.currentTarget;\r\n        const formData = new FormData(form);\r\n\r\n        // Immediate client-side pass.', handle_submit_patch)

docs_tab_patch = '''                                                        />
                                                    </div>

                                                    <div className="col-span-2 space-y-3 mt-4 p-4 border border-indigo-100 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/30 rounded-xl">
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
                                                    </div>
                                                </div>
                                            </TabsContent>
                                            </div>'''
content = content.replace('                                                        />\n                                                    </div>\n                                                </div>\n                                            </TabsContent>\n                                            </div>', docs_tab_patch)
content = content.replace('                                                        />\r\n                                                    </div>\r\n                                                </div>\r\n                                            </TabsContent>\r\n                                            </div>', docs_tab_patch)

open('app/employees/employee-list.tsx', 'w', encoding='utf-8').write(content)
print("done!")
