"use client"

import * as React from "react"
import { format } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export interface DatePickerProps {
  name?: string
  required?: boolean
  className?: string
  defaultValue?: string | Date
  value?: Date | string
  onChange?: (date: Date | undefined) => void
  placeholder?: string
}

export function DatePicker({
  name,
  required,
  className,
  defaultValue,
  value,
  onChange,
  placeholder = "Pick a date",
}: DatePickerProps) {
  const [internalDate, setInternalDate] = React.useState<Date | undefined>(
    defaultValue ? new Date(defaultValue) : undefined
  )

  const isControlled = value !== undefined
  const date = isControlled ? (value ? new Date(value) : undefined) : internalDate

  const handleSelect = (selectedDate: Date | undefined) => {
    if (!isControlled) {
      setInternalDate(selectedDate)
    }
    if (onChange) {
      onChange(selectedDate)
    }
  }

  // Format the date for the hidden input (YYYY-MM-DD)
  const isoDate = date ? format(date, "yyyy-MM-dd") : ""

  return (
    <Popover>
      {name && (
        <input 
          type="hidden" 
          name={name} 
          value={isoDate} 
          required={required} 
        />
      )}
      <PopoverTrigger asChild>
        <Button
          variant={"outline"}
          className={cn(
            "w-full justify-start text-left font-normal h-12 rounded-xl bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 focus-visible:ring-indigo-500 shadow-sm",
            !date && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 text-slate-400" />
          {date ? format(date, "PPP") : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 rounded-xl" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={handleSelect}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  )
}
