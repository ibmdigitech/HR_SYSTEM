import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { authorizePermission } from '@/lib/auth/guards';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { logSecurityEvent, SECURITY_ACTION } from '@/lib/auth/audit';

const DEFAULT_CONFIGS = [
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

export async function POST() {
    // Centralized guard: 401 without a session, 403 without the capability.
    const auth = await authorizePermission(PERMISSIONS.SERVICE_CONFIG_MANAGE);
    if (!auth.ok) {
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            outcome: 'DENIED',
            requestPath: '/api/configs/reset',
            requestMethod: 'POST',
            detail: { status: auth.status },
        });
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    try {
        for (const config of DEFAULT_CONFIGS) {
            await prisma.serviceConfig.upsert({
                where: { module_key: { module: config.module, key: config.key } },
                update: { value: config.value, type: config.type, label: config.label, options: config.options },
                create: config,
            });
        }
        await logSecurityEvent({
            action: SECURITY_ACTION.ACCESS_DENIED,
            actorEmail: auth.user.email,
            actorRole: auth.user.role,
            target: 'serviceConfig:catalogue',
            outcome: 'SUCCESS',
            detail: { change: 'resetToDefaults', count: DEFAULT_CONFIGS.length },
        });
        return NextResponse.json({ message: 'Configurations reset to default' });
    } catch (error) {
        console.error('[CONFIGS_RESET]', error);
        return NextResponse.json({ error: 'Failed to reset configurations' }, { status: 500 });
    }
}
