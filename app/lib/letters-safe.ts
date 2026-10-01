export type LetterEmployeeLike = {
  firstName?: string | null;
  lastName?: string | null;
  rollNumber?: string | null;
};

export function getLetterEmployeeDisplayName(employee: LetterEmployeeLike | null | undefined): string {
  if (!employee) return "Unknown employee";
  const firstName = (employee.firstName ?? "").trim();
  const lastName = (employee.lastName ?? "").trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  return fullName || "Unknown employee";
}

export function getLetterEmployeeInitials(employee: LetterEmployeeLike | null | undefined): string {
  if (!employee) return "?";
  const first = Array.from((employee.firstName ?? "").trim())[0] ?? "";
  const last = Array.from((employee.lastName ?? "").trim())[0] ?? "";
  return `${first}${last}`.toUpperCase() || "?";
}
