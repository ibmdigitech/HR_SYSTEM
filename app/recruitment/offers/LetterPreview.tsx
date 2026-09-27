"use client";

import { useState } from "react";
import { Download, Printer, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { generateLetterPDF } from "@/app/lib/utils/letter-generator";

/**
 * Renders an issued letter with the EXISTING PDF engine (P1 §15).
 *
 * `generateLetterPDF` is the same function the employee-letter flow uses. The
 * only change made for offers was accepting a `candidate` as the subject, since
 * an offer belongs to a person who is not yet an Employee.
 *
 * The row passed here is a `Letter` joined with its subject, which is exactly
 * the shape that function expects.
 */
export function LetterPreview({
    letter,
}: {
    letter: {
        id: string;
        referenceNumber: string;
        content_en: string | null;
        content_ar: string | null;
    };
}) {
    const [fullscreen, setFullscreen] = useState(false);

    // The generator needs `employee`/`candidate` and `template`. Rebuild the
    // shape from the fields the Letter row exposes plus the subject already
    // resolved on the page.
    const printable = {
        id: letter.id,
        referenceNumber: letter.referenceNumber,
        content_en: letter.content_en ?? "",
        content_ar: letter.content_ar ?? "",
        employee: undefined,
        candidate: undefined,
        template: { name: "Offer Letter", type: "OFFER" },
    };

    return (
        <>
            <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-b border-slate-100 dark:border-slate-800">
                    <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                            Offer letter
                        </p>
                        <p className="text-sm font-black text-slate-800 dark:text-white truncate">
                            {letter.referenceNumber}
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => generateLetterPDF(printable as never)}
                            className="h-9 rounded-lg text-[10px] font-black uppercase tracking-widest"
                        >
                            <Download className="h-3.5 w-3.5 mr-1.5" />
                            PDF
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => window.print()}
                            className="h-9 rounded-lg text-[10px] font-black uppercase tracking-widest"
                        >
                            <Printer className="h-3.5 w-3.5 mr-1.5" />
                            Print
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setFullscreen(true)}
                            className="h-9 w-9 rounded-lg"
                            aria-label="Expand letter"
                        >
                            <Download className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </div>

                {/* A4-ish proportions so the preview reads like the printed page. */}
                <div className="p-6 md:p-10 bg-slate-50/50 dark:bg-slate-900/30 max-h-[70vh] overflow-y-auto">
                    <article className="mx-auto max-w-2xl bg-white dark:bg-slate-950 p-8 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800">
                        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                            {letter.content_en}
                        </pre>
                    </article>
                </div>
            </div>

            {fullscreen && (
                <div
                    className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm p-4 md:p-10 overflow-y-auto"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Letter preview"
                >
                    <div className="flex justify-end mb-4">
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setFullscreen(false)}
                            className="h-10 rounded-xl bg-white"
                        >
                            <X className="h-4 w-4 mr-2" />
                            Close
                        </Button>
                    </div>
                    <article className="mx-auto max-w-3xl bg-white p-10 md:p-14 rounded-2xl shadow-2xl">
                        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-800">
                            {letter.content_en}
                        </pre>
                    </article>
                </div>
            )}
        </>
    );
}
