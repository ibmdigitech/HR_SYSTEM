import * as React from "react"

export const Form = React.forwardRef<
  HTMLFormElement,
  React.FormHTMLAttributes<HTMLFormElement>
>(({ className, ...props }, ref) => (
  <form
    className={className}
    ref={ref}
    {...props}
  />
))
Form.displayName = "Form"

export const FormItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    className={className}
    ref={ref}
    {...props}
  />
))
FormItem.displayName = "FormItem"

export const FormControl = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    className={className}
    ref={ref}
    {...props}
  />
))
FormControl.displayName = "FormControl"

export const FormDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    className={className}
    ref={ref}
    {...props}
  />
))
FormDescription.displayName = "FormDescription"

export const FormField = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    className={className}
    ref={ref}
    {...props}
  />
))
FormField.displayName = "FormField"

export const FormLabel = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, htmlFor, ...props }, ref) => (
  <label
    className={className}
    htmlFor={htmlFor}
    ref={ref}
    {...props}
  />
))
FormLabel.displayName = "FormLabel"

export const FormMessage = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    className={className}
    ref={ref}
    {...props}
  />
))
FormMessage.displayName = "FormMessage"