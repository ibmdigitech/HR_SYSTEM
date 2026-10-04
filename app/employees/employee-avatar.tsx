"use client";

import { useState, useEffect } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { normalizeEmployeePhotoValue } from "@/app/lib/photo";
import { cn } from "@/lib/utils";

/**
 * The employee directory renders TWICE: a card list below `md`, and a table at
 * `md` and up. Each view used to carry its own copy of the initials expression
 * and its own gradient, which is precisely how a person ends up one colour on a
 * phone and another colour on a laptop. The colour is the fastest way for a
 * user to recognise a row, so it must be the same everywhere. Both views now
 * render this component and call the functions below — there is no second
 * colour algorithm anywhere in `app/employees/`.
 */

/** Structural: a Prisma row, a JSON-serialised copy of one, or a test fixture. */
export type EmployeeAvatarSource = {
    id?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    photo?: string | null;
};

/**
 * Complete literal class strings, never interpolated ones.
 *
 * Tailwind scans the SOURCE TEXT. `from-${hue}-500` or
 * `palette[i].replace(...)` produce tokens that appear nowhere in any file, so
 * the browser gets no rule for them and the circle falls back to the
 * `AvatarFallback` grey. Each entry below is written out in full so the scanner
 * sees `from-indigo-500` and `to-violet-600` as real words.
 */
export const EMPLOYEE_AVATAR_PALETTES = [
    "bg-gradient-to-br from-indigo-500 to-violet-600 text-white",
    "bg-gradient-to-br from-sky-500 to-cyan-600 text-white",
    "bg-gradient-to-br from-emerald-500 to-teal-600 text-white",
    "bg-gradient-to-br from-amber-500 to-orange-600 text-white",
    "bg-gradient-to-br from-rose-500 to-pink-600 text-white",
    "bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white",
] as const;

/**
 * First glyph of the trimmed first and last name: `AU` for "Aisha Usmani".
 *
 * `Array.from(...)[0]` rather than `[0]`, so a name that starts outside the
 * Basic Multilingual Plane cannot be sliced into a lone surrogate half.
 */
export function employeeInitials(
    employee: EmployeeAvatarSource | null | undefined
): string {
    const first = Array.from((employee?.firstName ?? "").trim())[0] ?? "";
    const last = Array.from((employee?.lastName ?? "").trim())[0] ?? "";
    return `${first}${last}`.toUpperCase() || "?";
}

/** The record id when there is one, otherwise the name. */
function paletteKey(employee: EmployeeAvatarSource | null | undefined): string {
    const id = (employee?.id ?? "").trim();
    if (id) return `id:${id}`;
    const name = `${(employee?.firstName ?? "").trim()} ${(employee?.lastName ?? "").trim()}`.trim();
    return `name:${name}`;
}

/**
 * FNV-1a over the record key.
 *
 * Deliberately keyed on the id and NOT on the position in the list. A
 * position-derived palette repaints the entire directory every time the search
 * box or the status filter changes, so the colour identifies a row rather than
 * a person — and the two views, which filter identically but render
 * independently, would be one keystroke apart.
 */
export function employeeAvatarPalette(
    employee: EmployeeAvatarSource | null | undefined
): string {
    const key = paletteKey(employee);
    let hash = 0x811c9dc5;
    for (let i = 0; i < key.length; i += 1) {
        hash ^= key.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return EMPLOYEE_AVATAR_PALETTES[hash % EMPLOYEE_AVATAR_PALETTES.length];
}

/**
 * The single avatar for both views.
 *
 * `alt=""` is intentional: the employee's name is rendered immediately beside
 * this element in both views, so the image is decorative and announcing the
 * initials as well would read the name twice to a screen reader.
 */
export function EmployeeAvatar({
    employee,
    className,
    fallbackClassName,
}: {
    employee: EmployeeAvatarSource;
    className?: string;
    fallbackClassName?: string;
}) {
    const avatarSrc = normalizeEmployeePhotoValue(employee.photo) ?? undefined;
    const [imageError, setImageError] = useState(false);

    // Reset error state when the image source changes, so updated photos can load
    useEffect(() => {
        setImageError(false);
    }, [avatarSrc]);

    const src = imageError ? undefined : avatarSrc;

    return (
        <Avatar
            className={cn(
                "h-11 w-11 overflow-hidden border-2 border-white shadow-md dark:border-slate-800",
                className
            )}
        >
            <AvatarImage
                src={src}
                alt=""
                className="object-cover"
                onError={() => setImageError(true)}
            />
            <AvatarFallback
                className={cn(
                    employeeAvatarPalette(employee),
                    "font-black",
                    fallbackClassName
                )}
            >
                {employeeInitials(employee)}
            </AvatarFallback>
        </Avatar>
    );
}
