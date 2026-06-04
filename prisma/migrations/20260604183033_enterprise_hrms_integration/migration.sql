-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "issueDate" DATETIME NOT NULL,
    "installmentAmount" REAL NOT NULL,
    "remainingBalance" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Loan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Overtime" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "hours" REAL NOT NULL,
    "ratePerHour" REAL NOT NULL,
    "totalPay" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Overtime_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SalaryRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "basic" REAL NOT NULL,
    "housingAllowance" REAL NOT NULL DEFAULT 0,
    "transportAllowance" REAL NOT NULL DEFAULT 0,
    "medicalAllowance" REAL NOT NULL DEFAULT 0,
    "foodAllowance" REAL NOT NULL DEFAULT 0,
    "travelAllowance" REAL NOT NULL DEFAULT 0,
    "commission" REAL NOT NULL DEFAULT 0,
    "otherAllowances" REAL NOT NULL DEFAULT 0,
    "latePenalty" REAL NOT NULL DEFAULT 0,
    "penalty" REAL NOT NULL DEFAULT 0,
    "leaveDeduction" REAL NOT NULL DEFAULT 0,
    "loanDeduction" REAL NOT NULL DEFAULT 0,
    "advanceSalary" REAL NOT NULL DEFAULT 0,
    "otherDeductions" REAL NOT NULL DEFAULT 0,
    "overtimePay" REAL NOT NULL DEFAULT 0,
    "bonus" REAL NOT NULL DEFAULT 0,
    "netSalary" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "paymentMethod" TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SalaryRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SalaryRecord" ("basic", "bonus", "createdAt", "employeeId", "housingAllowance", "id", "latePenalty", "leaveDeduction", "loanDeduction", "medicalAllowance", "month", "netSalary", "otherAllowances", "otherDeductions", "overtimePay", "paidAt", "paymentMethod", "status", "transportAllowance", "updatedAt", "year") SELECT "basic", "bonus", "createdAt", "employeeId", "housingAllowance", "id", "latePenalty", "leaveDeduction", "loanDeduction", "medicalAllowance", "month", "netSalary", "otherAllowances", "otherDeductions", "overtimePay", "paidAt", "paymentMethod", "status", "transportAllowance", "updatedAt", "year" FROM "SalaryRecord";
DROP TABLE "SalaryRecord";
ALTER TABLE "new_SalaryRecord" RENAME TO "SalaryRecord";
CREATE TABLE "new_SalaryStructure" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "ctc" REAL NOT NULL DEFAULT 0,
    "basic" REAL NOT NULL DEFAULT 0,
    "housingAllowance" REAL NOT NULL DEFAULT 0,
    "transportAllowance" REAL NOT NULL DEFAULT 0,
    "medicalAllowance" REAL NOT NULL DEFAULT 0,
    "foodAllowance" REAL NOT NULL DEFAULT 0,
    "travelAllowance" REAL NOT NULL DEFAULT 0,
    "commission" REAL NOT NULL DEFAULT 0,
    "otherAllowances" REAL NOT NULL DEFAULT 0,
    "paymentMethod" TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
    "bankName" TEXT,
    "iban" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SalaryStructure_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SalaryStructure" ("bankName", "basic", "createdAt", "ctc", "employeeId", "housingAllowance", "iban", "id", "medicalAllowance", "otherAllowances", "paymentMethod", "transportAllowance", "updatedAt") SELECT "bankName", "basic", "createdAt", "ctc", "employeeId", "housingAllowance", "iban", "id", "medicalAllowance", "otherAllowances", "paymentMethod", "transportAllowance", "updatedAt" FROM "SalaryStructure";
DROP TABLE "SalaryStructure";
ALTER TABLE "new_SalaryStructure" RENAME TO "SalaryStructure";
CREATE UNIQUE INDEX "SalaryStructure_employeeId_key" ON "SalaryStructure"("employeeId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
