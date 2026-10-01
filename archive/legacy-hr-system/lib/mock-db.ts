
import { v4 as uuidv4 } from 'uuid';

// Types mimicking the Prisma schema
export type Employee = {
    id: string;
    rollNumber: string; // Added Roll Number
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    designation: string;
    department?: string;
    joiningDate: Date;
    isActive: boolean;
};

export type SalaryStructure = {
    id: string;
    employeeId: string;
    ctc: number;
    basic: number;
    hra: number;
    allowances: number;
    deductions: number;
};

export type PayrollRecord = {
    id: string;
    employeeId: string;
    month: number;
    year: number;
    basic: number;
    hra: number;
    allowances: number;
    deductions: number;
    netSalary: number;
    status: 'GENERATED' | 'PAID';
    generatedAt: Date;
};

export type LetterRecord = {
    id: string;
    employeeId?: string;
    type: 'OFFER' | 'APPOINTMENT' | 'RELIEVING';
    recipientName: string;
    generatedAt: Date;
};

// In-memory storage
let employees: Employee[] = [
    {
        id: 'emp-1',
        rollNumber: 'EMP-001',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        designation: 'Software Engineer',
        department: 'Engineering',
        joiningDate: new Date('2023-01-15'),
        isActive: true,
    },
    {
        id: 'emp-2',
        rollNumber: 'EMP-002',
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane.smith@example.com',
        designation: 'HR Manager',
        department: 'Human Resources',
        joiningDate: new Date('2022-05-10'),
        isActive: true,
    }
];

let salaryStructures: SalaryStructure[] = [
    {
        id: 'ss-1',
        employeeId: 'emp-1',
        ctc: 1200000,
        basic: 600000,
        hra: 300000,
        allowances: 200000,
        deductions: 100000,
    },
    {
        id: 'ss-2',
        employeeId: 'emp-2',
        ctc: 1500000,
        basic: 750000,
        hra: 375000,
        allowances: 250000,
        deductions: 125000,
    }
];

let payrollRecords: PayrollRecord[] = [];
let letterRecords: LetterRecord[] = [];

// Service functions
export const mockDb = {
    employee: {
        findMany: async () => [...employees],
        findUnique: async (id: string) => employees.find(e => e.id === id) || null,
        create: async (data: Omit<Employee, 'id' | 'rollNumber'>) => {
            // Auto-generate Roll Number
            const lastEmp = employees[employees.length - 1];
            let nextNum = 1;
            if (lastEmp && lastEmp.rollNumber.startsWith('EMP-')) {
                const parts = lastEmp.rollNumber.split('-');
                if (parts.length === 2 && !isNaN(parseInt(parts[1]))) {
                    nextNum = parseInt(parts[1]) + 1;
                }
            }
            const rollNumber = `EMP-${nextNum.toString().padStart(3, '0')}`;

            const newEmp = {
                ...data,
                id: uuidv4(),
                rollNumber
            };
            employees.push(newEmp);
            return newEmp;
        }
    },
    salaryStructure: {
        findUnique: async (employeeId: string) => salaryStructures.find(s => s.employeeId === employeeId) || null,
        upsert: async (employeeId: string, data: Omit<SalaryStructure, 'id' | 'employeeId'>) => {
            const existing = salaryStructures.findIndex(s => s.employeeId === employeeId);
            if (existing > -1) {
                salaryStructures[existing] = { ...salaryStructures[existing], ...data };
                return salaryStructures[existing];
            } else {
                const newStruct = { ...data, id: uuidv4(), employeeId };
                salaryStructures.push(newStruct);
                return newStruct;
            }
        }
    },
    payroll: {
        findMany: async () => [...payrollRecords],
        create: async (data: Omit<PayrollRecord, 'id'>) => {
            const newRecord = { ...data, id: uuidv4() };
            payrollRecords.push(newRecord);
            return newRecord;
        }
    },
    letter: {
        create: async (data: Omit<LetterRecord, 'id'>) => {
            const newLetter = { ...data, id: uuidv4() };
            letterRecords.push(newLetter);
            return newLetter;
        }
    }
};
