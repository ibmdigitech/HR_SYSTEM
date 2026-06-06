import * as React from "react"

import { cn } from "@/lib/utils"

export interface CheckboxProps
  extends React.ComponentPropsWithoutRef<"input"> {
  checked?: boolean
  defaultChecked?: boolean
  disabled?: boolean
  required?: boolean
  name?: string
  value?: string
  onCheckedChange?: (checked: boolean) => void
}

const Checkbox = React.forwardRef<
  HTMLInputElement,
  CheckboxProps
>(({ className, checked, defaultChecked, disabled, required, name, value, onCheckedChange, ...props }, ref) => {
  return (
    <input
      type="checkbox"
      checked={checked}
      defaultChecked={defaultChecked}
      disabled={disabled}
      required={required}
      name={name}
      value={value}
      onChange={(e) => {
        onCheckedChange?.(e.target.checked)
      }}
      className={cn(
        "h-4 w-4 shrink-0 rounded border-gray-300 bg-gray-50 text-indigo-600 focus:ring-indigo-500",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Checkbox.displayName = "Checkbox"

export { Checkbox }