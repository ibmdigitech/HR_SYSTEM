-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Attendance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "checkIn" DATETIME,
    "checkOut" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PRESENT',
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "shiftId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Attendance_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Attendance" ("checkIn", "checkOut", "createdAt", "date", "employeeId", "id", "lateMinutes", "overtimeMinutes", "shiftId", "status", "updatedAt") SELECT "checkIn", "checkOut", "createdAt", "date", "employeeId", "id", "lateMinutes", "overtimeMinutes", "shiftId", "status", "updatedAt" FROM "Attendance";
DROP TABLE "Attendance";
ALTER TABLE "new_Attendance" RENAME TO "Attendance";
CREATE TABLE "new_Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "employeeCode" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "rollNumber" TEXT NOT NULL,
    "photo" TEXT,
    "phone" TEXT,
    "gender" TEXT,
    "dateOfBirth" DATETIME,
    "nationality" TEXT,
    "maritalStatus" TEXT,
    "designation" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "joiningDate" DATETIME NOT NULL,
    "employmentType" TEXT NOT NULL DEFAULT 'FULL_TIME',
    "workLocation" TEXT,
    "probationDays" INTEGER NOT NULL DEFAULT 90,
    "currentStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "managerId" TEXT,
    "address" TEXT,
    "permanentAddress" TEXT,
    "emergencyContact" TEXT,
    "emergencyPhone" TEXT,
    "governmentId" TEXT,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "iban" TEXT,
    "ifscCode" TEXT,
    "basicSalary" REAL,
    "housingAllowance" REAL,
    "transportAllowance" REAL,
    "otherAllowance" REAL,
    "passportNumber" TEXT,
    "passportExpiry" DATETIME,
    "emiratesId" TEXT,
    "emiratesIdExpiry" DATETIME,
    "visaNumber" TEXT,
    "visaExpiry" DATETIME,
    "visaType" TEXT,
    "medicalInsuranceExpiry" DATETIME,
    "iloeInsuranceExpiry" DATETIME,
    "shiftId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Employee_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Employee_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Employee" ("accountNumber", "address", "bankName", "basicSalary", "createdAt", "currentStatus", "dateOfBirth", "department", "designation", "email", "emergencyContact", "emergencyPhone", "emiratesId", "emiratesIdExpiry", "employeeCode", "employmentType", "firstName", "gender", "governmentId", "housingAllowance", "iban", "id", "ifscCode", "iloeInsuranceExpiry", "isActive", "joiningDate", "lastName", "managerId", "maritalStatus", "medicalInsuranceExpiry", "nationality", "otherAllowance", "passportExpiry", "passportNumber", "permanentAddress", "phone", "photo", "probationDays", "rollNumber", "shiftId", "transportAllowance", "updatedAt", "userId", "visaExpiry", "visaNumber", "visaType", "workLocation") SELECT "accountNumber", "address", "bankName", "basicSalary", "createdAt", "currentStatus", "dateOfBirth", "department", "designation", "email", "emergencyContact", "emergencyPhone", "emiratesId", "emiratesIdExpiry", "employeeCode", "employmentType", "firstName", "gender", "governmentId", "housingAllowance", "iban", "id", "ifscCode", "iloeInsuranceExpiry", "isActive", "joiningDate", "lastName", "managerId", "maritalStatus", "medicalInsuranceExpiry", "nationality", "otherAllowance", "passportExpiry", "passportNumber", "permanentAddress", "phone", "photo", "probationDays", "rollNumber", "shiftId", "transportAllowance", "updatedAt", "userId", "visaExpiry", "visaNumber", "visaType", "workLocation" FROM "Employee";
DROP TABLE "Employee";
ALTER TABLE "new_Employee" RENAME TO "Employee";
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");
CREATE UNIQUE INDEX "Employee_employeeCode_key" ON "Employee"("employeeCode");
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");
CREATE UNIQUE INDEX "Employee_rollNumber_key" ON "Employee"("rollNumber");
CREATE TABLE "new_LeaveBalance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "leaveType" TEXT NOT NULL,
    "totalDays" INTEGER NOT NULL DEFAULT 0,
    "usedDays" INTEGER NOT NULL DEFAULT 0,
    "year" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeaveBalance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_LeaveBalance" ("createdAt", "employeeId", "id", "leaveType", "totalDays", "updatedAt", "usedDays", "year") SELECT "createdAt", "employeeId", "id", "leaveType", "totalDays", "updatedAt", "usedDays", "year" FROM "LeaveBalance";
DROP TABLE "LeaveBalance";
ALTER TABLE "new_LeaveBalance" RENAME TO "LeaveBalance";
CREATE UNIQUE INDEX "LeaveBalance_employeeId_leaveType_year_key" ON "LeaveBalance"("employeeId", "leaveType", "year");
CREATE TABLE "new_SalaryStructure" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "ctc" REAL NOT NULL DEFAULT 0,
    "basic" REAL NOT NULL DEFAULT 0,
    "housingAllowance" REAL NOT NULL DEFAULT 0,
    "transportAllowance" REAL NOT NULL DEFAULT 0,
    "medicalAllowance" REAL NOT NULL DEFAULT 0,
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
