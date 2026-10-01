const { PrismaClient } = require('../prisma/generated/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DATABASE_URL || 'file:./dev.db'
        }
    }
});

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

        console.log('Seeding Service Configurations...');
        const serviceConfigs = [
            // Payroll
            { module: 'payroll', key: 'payroll_cycle', label: 'Payroll Cycle', type: 'select', value: 'Monthly', options: ['Monthly', 'Weekly'] },
            { module: 'payroll', key: 'basic_salary_percentage', label: 'Basic Salary %', type: 'number', value: '50' },
            { module: 'payroll', key: 'overtime_rate_per_hour', label: 'Overtime Rate (Hour)', type: 'number', value: '1.5' },
            { module: 'payroll', key: 'late_penalty_amount', label: 'Late Penalty Amount', type: 'number', value: '50' },
            { module: 'payroll', key: 'auto_generate_payroll', label: 'Auto Generate Payroll', type: 'boolean', value: 'false' },
            { module: 'payroll', key: 'WPS_enabled', label: 'WPS Enabled', type: 'boolean', value: 'true' },

            // Attendance
            { module: 'attendance', key: 'working_hours_per_day', label: 'Working Hours/Day', type: 'number', value: '8' },
            { module: 'attendance', key: 'grace_period_minutes', label: 'Grace Period (Min)', type: 'number', value: '15' },
            { module: 'attendance', key: 'late_mark_threshold', label: 'Late Mark Threshold', type: 'number', value: '3' },
            { module: 'attendance', key: 'overtime_enabled', label: 'Overtime Enabled', type: 'boolean', value: 'true' },

            // Leave
            { module: 'leave', key: 'annual_leave_days', label: 'Annual Leave Days', type: 'number', value: '30' },
            { module: 'leave', key: 'sick_leave_days', label: 'Sick Leave Days', type: 'number', value: '15' },
            { module: 'leave', key: 'leave_auto_approval_days', label: 'Auto-Approval Days', type: 'number', value: '3' },
            { module: 'leave', key: 'carry_forward_enabled', label: 'Carry Forward', type: 'boolean', value: 'true' },

            // Visa
            { module: 'visa', key: 'passport_expiry_alert_days', label: 'Passport Expiry Alert (Days)', type: 'number', value: '30' },
            { module: 'visa', key: 'visa_expiry_alert_days', label: 'Visa Expiry Alert (Days)', type: 'number', value: '30' },
            { module: 'visa', key: 'auto_flag_expired', label: 'Auto Flag Expired', type: 'boolean', value: 'true' },

            // Notifications
            { module: 'notifications', key: 'email_notifications_enabled', label: 'Email Notifications', type: 'boolean', value: 'true' },
            { module: 'notifications', key: 'admin_alerts_enabled', label: 'Admin Alerts', type: 'boolean', value: 'true' },
        ];

        for (const config of serviceConfigs) {
            await prisma.serviceConfig.upsert({
                where: { module_key: { module: config.module, key: config.key } },
                update: config,
                create: config
            });
        }

        console.log('Seeding Complete!');

    } catch (e) {
        console.error(e);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
