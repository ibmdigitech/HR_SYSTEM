"use client"

import * as React from "react";
import { format, isValid, parse } from "date-fns";
import { Calendar as CalendarIcon, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface DatePickerProps {
  name?: string;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  defaultValue?: string | Date;
  value?: Date | string;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}

function asDate(value?: string | Date): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    if (!isValid(value)) return undefined;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const raw = value.trim();
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const parsed = parse(raw, "yyyy-MM-dd", new Date());
    return isValid(parsed) && format(parsed, "yyyy-MM-dd") === raw ? parsed : undefined;
  }
  const parsed = new Date(raw);
  return isValid(parsed) ? new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()) : undefined;
}

function parseTypedDate(raw: string): Date | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  const formats = ["dd/MM/yyyy", "d/M/yyyy", "yyyy-MM-dd", "d MMM yyyy", "d MMMM yyyy"];
  for (const dateFormat of formats) {
    const parsed = parse(value, dateFormat, new Date());
    if (isValid(parsed) && format(parsed, dateFormat) === value) return parsed;
  }
  return undefined;
}

export function DatePicker({
  name,
  id,
  required,
  disabled,
  className,
  defaultValue,
  value,
  onChange,
  placeholder = "DD/MM/YYYY",
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
}: DatePickerProps) {
  const isControlled = value !== undefined;
  const [internalDate, setInternalDate] = React.useState<Date | undefined>(() => asDate(defaultValue));
  const selectedDate = isControlled ? asDate(value) : internalDate;
  const [text, setText] = React.useState(() => selectedDate ? format(selectedDate, "dd/MM/yyyy") : "");
  const [invalid, setInvalid] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const isoDate = selectedDate && !invalid ? format(selectedDate, "yyyy-MM-dd") : "";

  React.useEffect(() => {
    if (!invalid) setText(selectedDate ? format(selectedDate, "dd/MM/yyyy") : "");
  }, [selectedDate ? format(selectedDate, "yyyy-MM-dd") : "", invalid]);

  const commit = (nextDate: Date | undefined) => {
    if (!isControlled) setInternalDate(nextDate);
    onChange?.(nextDate);
    setText(nextDate ? format(nextDate, "dd/MM/yyyy") : "");
    setInvalid(false);
    inputRef.current?.setCustomValidity("");
    setOpen(false);
  };

  const handleTextChange = (raw: string) => {
    setText(raw);
    if (!raw.trim()) {
      commit(undefined);
      return;
    }
    const parsed = parseTypedDate(raw);
    if (!parsed) {
      setInvalid(true);
      inputRef.current?.setCustomValidity("Enter a valid date as DD/MM/YYYY.");
      return;
    }
    if (!isControlled) setInternalDate(parsed);
    onChange?.(parsed);
    setInvalid(false);
    inputRef.current?.setCustomValidity("");
  };

  return (
    <div className="flex min-w-0 gap-2">
      {name && <input type="hidden" name={name} value={isoDate} />}
      <div className="relative min-w-0 flex-1">
        <Input
          ref={inputRef}
          id={id}
          type="text"
          value={text}
          onChange={(event) => handleTextChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              const parsed = parseTypedDate(text);
              if (parsed) commit(parsed);
              else if (text.trim()) setInvalid(true);
            }
          }}
          required={required}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="off"
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-invalid={invalid || ariaInvalid || undefined}
          className={cn(
            "h-12 rounded-xl bg-white pr-10 font-semibold shadow-sm dark:bg-slate-950",
            invalid && "border-rose-500 focus-visible:ring-rose-500",
            className
          )}
        />
        {text && !disabled && (
          <button
            type="button"
            aria-label="Clear date"
            onClick={() => commit(undefined)}
            className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={`Open calendar${ariaLabel ? ` for ${ariaLabel}` : ""}`}
            className="h-12 w-12 shrink-0 rounded-xl border-slate-200 bg-white shadow-sm hover:border-indigo-300 hover:bg-indigo-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-900"
          >
            <CalendarIcon className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto max-w-[calc(100vw-1rem)] rounded-2xl border-slate-200 p-2 shadow-xl dark:border-slate-800" align="end" sideOffset={6}>
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={commit}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
