"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Overlay>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Overlay
        ref={ref}
        className={cn(
            "fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            className
        )}
        {...props}
    />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Content>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
        /**
         * Class overrides for the built-in close button.
         *
         * The close control is painted onto whatever panel the caller chose,
         * and a panel's colour is the CALLER's decision, not the app theme's.
         * The mobile navigation drawer, for example, is explicitly dark
         * (`bg-slate-900`) even while the surrounding app is in light mode, so
         * no theme-derived class on this component can produce a visible icon
         * for both. `dark:` keys off the document, not off the panel.
         *
         * Radix's `DialogPrimitive.Close` takes no className of its own, so
         * this prop is the only way for a caller to style it. Defaults keep
         * every existing dialog unchanged.
         */
        closeButtonClassName?: string;
    }
>(({ className, children, closeButtonClassName, ...props }, ref) => (
    <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
            ref={ref}
            className={cn(
                // `w-full` alone resolves to the full viewport width on a phone,
                // so the panel touches both screen edges. `calc(100% - 2rem)`
                // leaves a gutter on mobile and reverts to `w-full` from `sm`.
                // `top-[50%]` centring means a dialog taller than the viewport
                // is clipped off BOTH edges with no way to scroll to the
                // content, so cap it to the dynamic viewport and scroll.
                // Callers that manage their own internal scroll (the employee
                // forms) override `max-h`/`overflow` via twMerge.
                "fixed left-[50%] top-[50%] z-50 grid w-[calc(100%_-_2rem)] sm:w-full max-w-lg max-h-[calc(100dvh_-_2rem)] overflow-y-auto translate-x-[-50%] translate-y-[-50%] gap-4 border border-slate-200 bg-white p-6 shadow-2xl ring-1 ring-slate-950/10 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-2xl dark:border-slate-700 dark:bg-slate-950 dark:ring-white/10",
                className
            )}
            {...props}
        >
            {children}
            {/*
              44x44 hit area, comfortably above the 44px minimum; the offsets
              place the 16px icon where the old paddingless `right-4 top-4`
              button put it. `closeButtonClassName` lets a caller on a dark panel
              supply a light icon — see the prop's note above.
            */}
            <DialogPrimitive.Close
                className={cn(
                    "absolute right-0.5 top-0.5 flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-500/15 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:pointer-events-none dark:text-slate-400 dark:hover:text-slate-100 dark:focus-visible:ring-slate-300 dark:focus-visible:ring-offset-slate-950",
                    closeButtonClassName
                )}
            >
                <X className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
        </DialogPrimitive.Content>
    </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
    <div
        className={cn(
            "flex flex-col space-y-1.5 text-center sm:text-left",
            className
        )}
        {...props}
    />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
    <div
        className={cn(
            "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
            className
        )}
        {...props}
    />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Title>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Title
        ref={ref}
        className={cn(
            "text-lg font-semibold leading-none tracking-tight",
            className
        )}
        {...props}
    />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
    React.ElementRef<typeof DialogPrimitive.Description>,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Description
        ref={ref}
        className={cn("text-sm text-slate-500 dark:text-slate-400", className)}
        {...props}
    />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
    Dialog,
    DialogPortal,
    DialogOverlay,
    DialogClose,
    DialogTrigger,
    DialogContent,
    DialogHeader,
    DialogFooter,
    DialogTitle,
    DialogDescription,
}
