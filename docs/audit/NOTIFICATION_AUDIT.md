# NOTIFICATION AUDIT

## Notification System Overview

**Model**: `Notification` (database)
**Delivery**: In-app only (toast + notification center)
**Real-time**: **NOT IMPLEMENTED** (polling only)
**Channels**: In-app only (no email, SMS, push)

---

## Notification Triggers

| Trigger | Source | Recipients | Template | Status |
|---------|--------|------------|----------|--------|
| Welcome | Employee onboarding | New employee | "Welcome to the Team!" | PASS |
| Leave Applied | Leave request | Manager | "Leave Request Submitted" | PASS |
| Leave Approved | Leave approval | Employee | "Leave Request Approved" | PASS |
| Leave Rejected | Leave rejection | Employee | "Leave Request Rejected" | PASS |
| Payroll Generated | Payroll generation | Employee | "Payslip Available" | **MISSING** |
| Loan Approved | Loan approval | Employee | "Loan Approved" | PASS |
| Loan Rejected | Loan rejection | Employee | "Loan Rejected" | PASS |
| Letter Generated | Letter generation | Employee | "Document Ready" | **MISSING** |
| Visa Expiring | Daily cron (not implemented) | HR, Employee | "Visa Expiring Soon" | **MISSING** |
| Passport Expiring | Daily cron (not implemented) | HR, Employee | "Passport Expiring Soon" | **MISSING** |
| Emirates ID Expiring | Daily cron (not implemented) | HR, Employee | "Emirates ID Expiring Soon" | **MISSING** |
| Medical Insurance Expiring | Daily cron (not implemented) | HR, Employee | "Insurance Expiring Soon" | **MISSING** |
| Attendance Anomaly | Attendance import | HR | "Attendance Anomaly Detected" | **MISSING** |
| Shift Assigned | Shift assignment | Employee | "New Shift Assigned" | **MISSING** |
| Overtime Approved | Overtime approval | Employee | "Overtime Approved" | **MISSING** |
| Reimbursement Submitted | Service request | Manager | "Reimbursement Submitted" | PASS |
| Reimbursement Approved | Service approval | Employee | "Reimbursement Approved" | PASS |
| Document Required | Visa/compliance | Employee | "Document Required" | **MISSING** |
| Performance Review Due | HR schedule | Employee, Manager | "Review Due" | **MISSING** |
| Contract Expiring | HR schedule | HR, Employee | "Contract Expiring" | **MISSING** |
| System Maintenance | Admin | All | "Scheduled Maintenance" | **MISSING** |

---

## Notification Model

```prisma
model Notification {
  id        String           @id @default(cuid())
  employeeId String
  employee  Employee         @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  userId    String?
  user      User?            @relation(fields: [userId], references: [id], onDelete: SetNull)
  title     String
  message   String
  type      NotificationType @default(INFO)
  read      Boolean          @default(false)
  link      String?
  createdAt DateTime         @default(now())
  
  @@index([employeeId, read])
  @@index([userId, read])
}

enum NotificationType {
  INFO
  SUCCESS
  WARNING
  ERROR
  URGENT
}
```

---

## Current Implementation

### Creation (Server Actions)
```typescript
// Example from employees.ts
await prisma.notification.create({
  data: {
    employeeId: employee.id,
    title: "Welcome to the Team! 🎉",
    message: `Welcome ${data.firstName}! Your employee profile (${employeeCode}) has been created.`,
    type: "SUCCESS",
    link: "/staff-services",
  },
})
```

### Display (Client)
- **Notification Bell**: Top nav, shows unread count
- **Dropdown**: Recent 10 notifications
- **Notifications Page**: `/notifications` - full list with filters
- **Toast**: Sonner for immediate feedback

### Real-time
**NOT IMPLEMENTED** - Uses polling (refetch on focus/interval)

---

## Gaps Analysis

| Gap | Impact | Severity |
|-----|--------|----------|
| **NOTIFY-001** | No email channel | Critical for compliance | HIGH |
| **NOTIFY-002** | No SMS channel | Critical for urgent alerts | HIGH |
| **NOTIFY-003** | No push notifications | Mobile engagement | MEDIUM |
| **NOTIFY-004** | No real-time (WebSocket/SSE) | Stale data | HIGH |
| **NOTIFY-005** | No automated expiry alerts | Compliance risk | CRITICAL |
| **NOTIFY-006** | No notification preferences | User control | MEDIUM |
| **NOTIFY-007** | No digest/summary emails | Noise reduction | LOW |
| **NOTIFY-008** | No template system | Maintainability | MEDIUM |
| **NOTIFY-009** | No delivery tracking | Audit/compliance | HIGH |
| **NOTIFY-010** | No retry on failure | Reliability | MEDIUM |
| **NOTIFY-011** | No batching | Performance | LOW |
| **NOTIFY-012** | No localization | Multi-language | MEDIUM |

---

## Missing Critical Notifications

### Compliance Alerts (UAE Labour Law)
| Alert | Trigger | Frequency | Recipients |
|-------|---------|-----------|------------|
| Visa Expiry (30/15/7/1 days) | `VisaRequest.visaExpiry` | Daily cron | HR, Employee |
| Emirates ID Expiry | `Employee.emiratesIdExpiry` | Daily cron | HR, Employee |
| Passport Expiry | `Employee.passportExpiry` | Daily cron | HR, Employee |
| Medical Insurance Expiry | `Employee.medicalInsuranceExpiry` | Daily cron | HR, Employee |
| Labour Card Expiry | `Employee.labourCardExpiry` (field missing) | Daily cron | HR, Employee |
| Contract Expiry (90/60/30 days) | `Employee.contractExpiry` (field missing) | Daily cron | HR, Employee |

### Operational Alerts
| Alert | Trigger | Frequency | Recipients |
|-------|---------|-----------|------------|
| Attendance Not Marked | Daily 10AM | Daily | Manager, HR |
| Leave Balance Low (< 5 days) | Monthly | Monthly | Employee, Manager |
| Overtime Exceeding Limit | Per attendance | Real-time | Manager, HR |
| Pending Approvals > 3 days | Daily 9AM | Daily | Approver, HR |
| Payroll Lock Approaching | 3 days before | Once per period | Payroll Admin |

---

## Notification Center (`/notifications`)

**Features**:
- List with pagination
- Filter by type (ALL, UNREAD, READ)
- Mark as read (individual/bulk)
- Delete (individual/bulk)
- Link to related entity

**Issues**:
- No search
- No date range filter
- No "Mark all as read"
- No email notification settings

---

## Toast Notifications (Sonner)

**Usage**: Immediate feedback for actions
- Success: Green, auto-dismiss 4s
- Error: Red, auto-dismiss 6s
- Warning: Amber, auto-dismiss 5s
- Info: Blue, auto-dismiss 4s
- Loading: Spinner, manual dismiss

**Accessibility**: `role="status"`, `aria-live="polite"`

**Issues**:
- No persistence (lost on refresh)
- No action buttons (e.g., "Undo")
- Stacking can obscure content

---

## Email Integration (Missing)

### Required Provider
- **SendGrid**, **Mailgun**, **AWS SES**, or **Resend**

### Template System Needed
```typescript
// lib/notifications/templates.ts
export const templates = {
  welcome: (data) => ({
    subject: `Welcome to ${companyName}!`,
    html: `<h1>Welcome ${data.firstName}</h1>...`,
    text: `Welcome ${data.firstName}...`
  }),
  leaveApproved: (data) => ({
    subject: `Leave Request Approved`,
    html: `<p>Your ${data.leaveType} leave from ${data.startDate} to ${data.endDate} has been approved.</p>`,
    text: `Your leave has been approved...`
  }),
  visaExpiring: (data) => ({
    subject: `URGENT: Visa Expiring in ${data.days} Days`,
    html: `<p>Dear ${data.employeeName}, your visa (${data.visaNumber}) expires on ${data.expiryDate}.</p>`,
    text: `Your visa expires in ${data.days} days...`
  })
}
```

### Delivery Service
```typescript
// lib/notifications/email.ts
export async function sendNotificationEmail(
  to: string,
  template: keyof typeof templates,
  data: any
) {
  const { subject, html, text } = templates[template](data)
  await emailProvider.send({ to, subject, html, text })
  // Log delivery
  await prisma.notificationDelivery.create({
    data: { notificationId, channel: 'EMAIL', status: 'SENT' }
  })
}
```

---

## SMS Integration (Missing)

### Provider Options
- **Twilio**, **Vonage**, **Plivo**, **Local UAE providers** (Etisalat, Du)

### Use Cases
- Visa expiry urgent (7 days)
- Attendance anomaly
- Emergency notifications
- OTP for MFA (future)

---

## Push Notifications (Missing)

### Web Push (Service Workers)
- VAPID keys
- Subscription management
- Background sync

### Mobile Push (Future App)
- Firebase Cloud Messaging
- APNs

---

## Real-time Implementation

### Option 1: Server-Sent Events (SSE)
```typescript
// app/api/notifications/stream/route.ts
export async function GET(request: Request) {
  const stream = new ReadableStream({
    start(controller) {
      // Subscribe to Redis channel
      // Send events as they occur
    }
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' }
  })
}
```

### Option 2: WebSocket (Socket.io)
- More complex, bidirectional
- Better for chat/collaboration

### Option 3: Pusher/Ably (Managed)
- Easiest to implement
- Cost at scale

---

## Notification Preferences (Missing)

```prisma
model NotificationPreference {
  id           String   @id @default(cuid())
  employeeId   String   @unique
  employee     Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)
  emailEnabled Boolean  @default(true)
  smsEnabled   Boolean  @default(false)
  pushEnabled  Boolean  @default(true)
  inAppEnabled Boolean  @default(true)
  // Per-type overrides
  leaveEmail   Boolean  @default(true)
  payrollEmail Boolean  @default(true)
  visaEmail    Boolean  @default(true)
  // Quiet hours
  quietStart   String?  // "22:00"
  quietEnd     String?  // "08:00"
  timezone     String   @default("Asia/Dubai")
}
```

---

## Delivery Tracking (Missing)

```prisma
model NotificationDelivery {
  id              String   @id @default(cuid())
  notificationId  String
  notification    Notification @relation(fields: [notificationId], references: [id], onDelete: Cascade)
  channel         Channel  // EMAIL, SMS, PUSH, IN_APP
  status          DeliveryStatus @default(PENDING)
  sentAt          DateTime?
  deliveredAt     DateTime?
  failedAt        DateTime?
  error           String?
  attempts        Int      @default(0)
  externalId      String?  // Provider message ID
}

enum Channel {
  EMAIL
  SMS
  PUSH
  IN_APP
}

enum DeliveryStatus {
  PENDING
  SENT
  DELIVERED
  FAILED
  BOUNCED
}
```

---

## Retry Logic (Missing)

```typescript
async function deliverWithRetry(delivery: NotificationDelivery, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await sendViaChannel(delivery.channel, delivery)
      delivery.status = 'SENT'
      delivery.sentAt = new Date()
      break
    } catch (error) {
      delivery.attempts = attempt
      delivery.error = error.message
      if (attempt === maxAttempts) {
        delivery.status = 'FAILED'
        delivery.failedAt = new Date()
        // Alert admin
      }
      await sleep(attempt * 1000) // Exponential backoff
    }
  }
}
```

---

## Recommendations

### Immediate (Week 1)
1. Implement automated expiry alerts (cron job)
2. Add email channel with SendGrid/Resend
3. Create notification template system
4. Add delivery tracking

### Short-term (Week 2)
5. Implement real-time with SSE
6. Add notification preferences
7. SMS integration for urgent alerts
8. Retry logic with exponential backoff

### Medium-term (Week 3-4)
9. Push notifications (web)
10. Digest emails
11. Localization (Arabic templates)
11. Analytics dashboard (open rates, delivery rates)
12. A/B testing for templates