const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
    console.log('Seeding...');
    const rawPassword = 'password123';
    const password = await bcrypt.hash(rawPassword, 10);

    try {
        const admin = await prisma.user.upsert({
            where: { email: 'admin@company.com' },
            update: { password: password },
            create: {
                email: 'admin@company.com',
                password: password,
                role: 'ADMIN',
                name: 'Admin User',
                employee: {
                    create: {
                        firstName: 'Admin',
                        lastName: 'User',
                        email: 'admin@company.com',
                        rollNumber: 'ADM-001',
                        designation: 'System Administrator',
                        department: 'IT',
                        joiningDate: new Date(),
                    }
                }
            },
        });
        console.log('Admin seeded:', admin);

        const manager = await prisma.user.upsert({
            where: { email: 'manager@company.com' },
            update: { password: password },
            create: {
                email: 'manager@company.com',
                password: password,
                role: 'MANAGER',
                name: 'Manager User',
                employee: {
                    create: {
                        firstName: 'Manager',
                        lastName: 'User',
                        email: 'manager@company.com',
                        rollNumber: 'MGR-001',
                        designation: 'Operations Manager',
                        department: 'Operations',
                        joiningDate: new Date(),
                    }
                }
            },
        });
        console.log('Manager seeded:', manager);

        const staff = await prisma.user.upsert({
            where: { email: 'staff@company.com' },
            update: { password: password },
            create: {
                email: 'staff@company.com',
                password: password,
                role: 'STAFF',
                name: 'Staff User',
                employee: {
                    create: {
                        firstName: 'Staff',
                        lastName: 'User',
                        email: 'staff@company.com',
                        rollNumber: 'STF-001',
                        designation: 'Software Developer',
                        department: 'Engineering',
                        joiningDate: new Date(),
                    }
                }
            },
        });
        console.log('Staff seeded:', staff);

        const employees = [admin, manager, staff];

        console.log('Seeding Attendance and Payroll...');
        for (const user of employees) {
            const employee = await prisma.employee.findUnique({ where: { userId: user.id } });
            if (!employee) continue;

            // Seed 7 days of attendance
            const now = new Date();
            for (let i = 0; i < 7; i++) {
                const date = new Date();
                date.setDate(now.getDate() - i);
                await prisma.attendance.create({
                    data: {
                        employeeId: employee.id,
                        date: date,
                        checkIn: new Date(date.setHours(9, 0, 0)),
                        checkOut: new Date(date.setHours(18, 0, 0)),
                        status: i % 7 === 0 ? "ABSENT" : "PRESENT",
                    }
                });
            }

            /*
                        // Seed Payroll
                        await prisma.salaryRecord.create({
                            data: {
                                employeeId: employee.id,
                                month: now.getMonth() + 1,
                                year: now.getFullYear(),
                                basic: 50000,
                                allowance: 5000,
                                deduction: 2000,
                                netSalary: 53000,
                                status: "PAID",
                                paidAt: new Date(),
                            }
                        });
            */
        }

        /*
                console.log('Seeding Service Types...');
                const serviceTypes = [
                    { name: 'Reimbursement', description: 'Office and travel expenses', requiresAmount: true, requiresDates: false },
                    { name: 'Overtime', description: 'Additional working hours', requiresAmount: false, requiresDates: true },
                    { name: 'Medical Payment', description: 'Hospital and medical bills', requiresAmount: true, requiresDates: false },
                    { name: 'Out of Emirates', description: 'Travel outside UAE', requiresAmount: false, requiresDates: true },
                    { name: 'EID Apply', description: 'Emirates ID application', requiresAmount: false, requiresDates: false },
                    { name: 'Visit Visa', description: 'Visit visa requests', requiresAmount: false, requiresDates: false },
                    { name: 'Miscellaneous', description: 'Other general requests', requiresAmount: false, requiresDates: false },
                ];
        
                for (const type of serviceTypes) {
                    await prisma.staffServiceType.upsert({
                        where: { name: type.name },
                        update: type,
                        create: type
                    });
                }
        */

        console.log('Seeding Complete!');

    } catch (e) {
        console.error(e);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
