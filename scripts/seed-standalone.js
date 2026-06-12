const { PrismaClient } = require('../prisma/generated/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || process.env.MONGODB_URI
    }
  }
});


async function main() {
    console.log('Seeding standalone...');
    const rawPassword = 'password123';
    const password = await bcrypt.hash(rawPassword, 10);

    try {
        // --- ADMIN USER ---
        let admin = await prisma.user.findUnique({ where: { email: 'admin@company.com' } });
        if (!admin) {
            admin = await prisma.user.create({
                data: {
                    email: 'admin@company.com',
                    password: password,
                    role: 'ADMIN',
                    name: 'Admin User',
                }
            });
        } else {
            admin = await prisma.user.update({
                where: { email: 'admin@company.com' },
                data: { password: password }
            });
        }

        let adminEmp = await prisma.employee.findUnique({ where: { userId: admin.id } });
        if (!adminEmp) {
            adminEmp = await prisma.employee.create({
                data: {
                    userId: admin.id,
                    firstName: 'Admin',
                    lastName: 'User',
                    email: 'admin@company.com',
                    rollNumber: 'ADM-001',
                    designation: 'System Administrator',
                    department: 'IT',
                    joiningDate: new Date(),
                }
            });
        }
        console.log('Admin seeded:', admin.email);

        // --- MANAGER USER ---
        let manager = await prisma.user.findUnique({ where: { email: 'manager@company.com' } });
        if (!manager) {
            manager = await prisma.user.create({
                data: {
                    email: 'manager@company.com',
                    password: password,
                    role: 'MANAGER',
                    name: 'Manager User',
                }
            });
        } else {
            manager = await prisma.user.update({
                where: { email: 'manager@company.com' },
                data: { password: password }
            });
        }

        let managerEmp = await prisma.employee.findUnique({ where: { userId: manager.id } });
        if (!managerEmp) {
            managerEmp = await prisma.employee.create({
                data: {
                    userId: manager.id,
                    firstName: 'Manager',
                    lastName: 'User',
                    email: 'manager@company.com',
                    rollNumber: 'MGR-001',
                    designation: 'Operations Manager',
                    department: 'Operations',
                    joiningDate: new Date(),
                }
            });
        }
        console.log('Manager seeded:', manager.email);

        // --- STAFF USER ---
        let staff = await prisma.user.findUnique({ where: { email: 'staff@company.com' } });
        if (!staff) {
            staff = await prisma.user.create({
                data: {
                    email: 'staff@company.com',
                    password: password,
                    role: 'STAFF',
                    name: 'Staff User',
                }
            });
        } else {
            staff = await prisma.user.update({
                where: { email: 'staff@company.com' },
                data: { password: password }
            });
        }

        let staffEmp = await prisma.employee.findUnique({ where: { userId: staff.id } });
        if (!staffEmp) {
            staffEmp = await prisma.employee.create({
                data: {
                    userId: staff.id,
                    firstName: 'Staff',
                    lastName: 'User',
                    email: 'staff@company.com',
                    rollNumber: 'STF-001',
                    designation: 'Software Developer',
                    department: 'Engineering',
                    joiningDate: new Date(),
                }
            });
        }
        console.log('Staff seeded:', staff.email);

        const employees = [
            { user: admin, emp: adminEmp },
            { user: manager, emp: managerEmp },
            { user: staff, emp: staffEmp }
        ];

        console.log('Seeding Attendance records...');
        for (const item of employees) {
            const employee = item.emp;
            
            // Check if attendance already exists to prevent duplication
            const existingAttendance = await prisma.attendance.findFirst({
                where: { employeeId: employee.id }
            });

            if (!existingAttendance) {
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
            }
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
            const existingType = await prisma.staffServiceType.findUnique({
                where: { name: type.name }
            });
            if (!existingType) {
                await prisma.staffServiceType.create({ data: type });
            }
        }

        console.log('Seeding Service Configurations...');
        const serviceConfigs = [
            // Payroll
            { module: 'payroll', key: 'payroll_cycle', label: 'Payroll Cycle', type: 'select', value: 'Monthly' },
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
            const existingConfig = await prisma.serviceConfig.findUnique({
                where: { module_key: { module: config.module, key: config.key } }
            });
            if (!existingConfig) {
                await prisma.serviceConfig.create({ data: config });
            } else {
                await prisma.serviceConfig.update({
                    where: { module_key: { module: config.module, key: config.key } },
                    data: { value: config.value }
                });
            }
        }

        console.log('Seeding Complete!');

    } catch (e) {
        console.error('Seeding failed:', e);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
