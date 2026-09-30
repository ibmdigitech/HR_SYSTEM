'use strict';

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * UAE Labour Law Leave Policies
 * 
 * Annual Leave: 30 days per year (after 1 year of service)
 * Sick Leave: 90 days per year (15 days full pay, 30 days half pay, 45 days unpaid)
 * Maternity Leave: 45 days full pay + 15 days half pay = 60 days total
 * Paternity Leave: 5 days (UAE Labour Law)
 * Hajj Leave: 30 days (once during service)
 * Bereavement: 3 days
 */

const UAE_LEAVE_POLICIES = [
  {
    leaveType: 'ANNUAL',
    annualEntitlement: 30,
    accrualFrequency: 'ANNUAL',
    accrualAmount: 30,
    carryForward: true,
    maximumBalance: 60, // Max 2 years accumulation
    hrReviewThresholdDays: 5,
    requiresHrReview: true,
    effectiveFrom: new Date(),
    isActive: true,
  },
  {
    leaveType: 'SICK',
    annualEntitlement: 90,
    accrualFrequency: 'ANNUAL',
    accrualAmount: 90,
    carryForward: false,
    maximumBalance: 90,
    hrReviewThresholdDays: 2,
    requiresHrReview: true,
    effectiveFrom: new Date(),
    isActive: true,
  },
  {
    leaveType: 'MATERNITY',
    annualEntitlement: 60,
    accrualFrequency: 'ANNUAL',
    accrualAmount: 60,
    carryForward: false,
    maximumBalance: 60,
    hrReviewThresholdDays: 1,
    requiresHrReview: true,
    effectiveFrom: new Date(),
    isActive: true,
  },
  {
    leaveType: 'PATERNITY',
    annualEntitlement: 5,
    accrualFrequency: 'ANNUAL',
    accrualAmount: 5,
    carryForward: false,
    maximumBalance: 5,
    hrReviewThresholdDays: 1,
    requiresHrReview: false,
    effectiveFrom: new Date(),
    isActive: true,
  },
  {
    leaveType: 'HAJJ',
    annualEntitlement: 30,
    accrualFrequency: 'ANNUAL',
    accrualAmount: 30,
    carryForward: false,
    maximumBalance: 30,
    hrReviewThresholdDays: 10,
    requiresHrReview: true,
    effectiveFrom: new Date(),
    isActive: true,
  },
  {
    leaveType: 'BEREAVEMENT',
    annualEntitlement: 3,
    accrualFrequency: 'ANNUAL',
    accrualAmount: 3,
    carryForward: false,
    maximumBalance: 3,
    hrReviewThresholdDays: 1,
    requiresHrReview: false,
    effectiveFrom: new Date(),
    isActive: true,
  },
  {
    leaveType: 'CASUAL',
    annualEntitlement: 6,
    accrualFrequency: 'ANNUAL',
    accrualAmount: 6,
    carryForward: false,
    maximumBalance: 6,
    hrReviewThresholdDays: 2,
    requiresHrReview: false,
    effectiveFrom: new Date(),
    isActive: true,
  },
  {
    leaveType: 'EMERGENCY',
    annualEntitlement: 3,
    accrualFrequency: 'ANNUAL',
    accrualAmount: 3,
    carryForward: false,
    maximumBalance: 3,
    hrReviewThresholdDays: 1,
    requiresHrReview: false,
    effectiveFrom: new Date(),
    isActive: true,
  },
  {
    leaveType: 'STUDY',
    annualEntitlement: 10,
    accrualFrequency: 'ANNUAL',
    accrualAmount: 10,
    carryForward: false,
    maximumBalance: 10,
    hrReviewThresholdDays: 5,
    requiresHrReview: true,
    effectiveFrom: new Date(),
    isActive: true,
  },
  {
    leaveType: 'UNPAID',
    annualEntitlement: 0,
    accrualFrequency: 'MANUAL',
    accrualAmount: 0,
    carryForward: false,
    maximumBalance: null,
    hrReviewThresholdDays: 1,
    requiresHrReview: true,
    effectiveFrom: new Date(),
    isActive: true,
  },
];

async function setupUAELeavePolicies() {
  console.log('🔧 Setting up UAE Labour Law leave policies...\n');

  try {
    for (const policy of UAE_LEAVE_POLICIES) {
      const existing = await prisma.leaveAccrualPolicy.findFirst({
        where: { leaveType: policy.leaveType, isActive: true },
        orderBy: { effectiveFrom: 'desc' },
      });

      if (existing) {
        console.log(`⏭️  ${policy.leaveType}: Policy already exists (ID: ${existing.id})`);
        continue;
      }

      const created = await prisma.leaveAccrualPolicy.create({
        data: policy,
      });

      console.log(`✅ ${policy.leaveType}: Created policy (ID: ${created.id})`);
      console.log(`   - Annual Entitlement: ${policy.annualEntitlement} days`);
      console.log(`   - Accrual: ${policy.accrualFrequency} (${policy.accrualAmount} days)`);
      console.log(`   - Carry Forward: ${policy.carryForward ? 'Yes' : 'No'}`);
      console.log(`   - Max Balance: ${policy.maximumBalance || 'No limit'}`);
      console.log(`   - HR Review Required: ${policy.requiresHrReview ? 'Yes (threshold: ' + policy.hrReviewThresholdDays + ' days)' : 'No'}`);
      console.log('');
    }

    console.log('🎉 UAE Labour Law leave policies setup complete!');
    console.log('\n📋 Summary of UAE Labour Law Leave Entitlements:');
    console.log('┌─────────────────┬───────────┬────────────────────────────────────────────┐');
    console.log('│ Leave Type      │ Days      │ Details                                    │');
    console.log('├─────────────────┼───────────┼────────────────────────────────────────────┤');
    console.log('│ Annual Leave    │ 30        │ After 1 year continuous service            │');
    console.log('│ Sick Leave      │ 90        │ 15 full pay, 30 half pay, 45 unpaid        │');
    console.log('│ Maternity Leave │ 60        │ 45 full pay + 15 half pay                  │');
    console.log('│ Paternity Leave │ 5         │ UAE Labour Law                             │');
    console.log('│ Hajj Leave      │ 30        │ Once during service                        │');
    console.log('│ Bereavement     │ 3         │ Immediate family                           │');
    console.log('│ Casual Leave    │ 6         │ Company policy                             │');
    console.log('│ Emergency Leave │ 3         │ Company policy                             │');
    console.log('│ Study Leave     │ 10        │ Company policy                             │');
    console.log('│ Unpaid Leave    │ As needed │ Requires approval                          │');
    console.log('└─────────────────┴───────────┴────────────────────────────────────────────┘');

  } catch (error) {
    console.error('❌ Error setting up policies:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

setupUAELeavePolicies()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));