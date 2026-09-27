# INTEGRATION AUDIT

## Integration Inventory

| Integration | Type | Status | Implementation | Auth | Error Handling |
|-------------|------|--------|----------------|------|----------------|
| Email | Outbound | **MISSING** | None | N/A | N/A |
| Biometric/Attendance Devices | Inbound | PARTIAL | `/api/attendance/import` | **NONE** | Basic |
| File Storage | Storage | **MISSING** | Database BLOB | N/A | N/A |
| PDF Generation | Generation | PASS | `pdf-lib`/`jspdf` (assumed) | N/A | Try-catch |
| Digital Stamp/Signature | Assets | PARTIAL | Static files in `/public/assets` | N/A | Basic |
| SMS | Outbound | **MISSING** | None | N/A | N/A |
| Push Notifications | Outbound | **MISSING** | None | N/A | N/A |
| Calendar (ICS) | Export | **MISSING** | None | N/A | N/A |
| Bank/WPS Export | Outbound | **MISSING** | None | N/A | N/A |
| Government Portals | Outbound | **MISSING** | None | N/A | N/A |
| OAuth (Google) | Auth | CONFIGURED | NextAuth Google | OAuth 2.0 | NextAuth |
| OAuth (Microsoft) | Auth | CONFIGURED | NextAuth Entra ID | OAuth 2.0 | NextAuth |
| Slack/Teams | Outbound | **MISSING** | None | N/A | N/A |
| Webhooks | Inbound/Outbound | **MISSING** | None | N/A | N/A |

---

## Detailed Integration Analysis

### INT-001: Email Integration (MISSING)

**Required For**:
- Welcome emails
- Leave approval/rejection
- Payslip delivery
- Visa expiry alerts
- Payroll notifications
- System announcements

**Current**: Only in-app notifications

**Recommended Provider**:
- **Resend** (React Email, simple API)
- **SendGrid** (Enterprise, templates)
- **AWS SES** (Cost-effective, high volume)
- **Mailgun** (Developer-friendly)

**Implementation**:
```typescript
// lib/integrations/email.ts
import { Resend } from 'resend'
const resend = new Resend(process.env.RESEND_API_KEY)

export async function sendEmail({ to, subject, html, text }) {
  const { data, error } = await resend.emails.send({
    from: 'HRMS <noreply@company.com>',
    to,
    subject,
    html,
    text
  })
  if (error) throw new Error(error.message)
  return data
}
```

**Environment Variables**:
```env
RESEND_API_KEY=re_xxx
EMAIL_FROM=HRMS <noreply@company.com>
EMAIL_REPLY_TO=hr@company.com
```

---

### INT-002: Biometric Attendance Devices (PARTIAL)

**Current Implementation**:
- Endpoint: `POST /api/attendance/import`
- Accepts: CSV/JSON file upload
- Parses: Employee ID, timestamp, punch type
- Creates: `BiometricLog`, `Attendance` records

**Issues**:
- **No authentication** - CRITICAL
- **No device registration** - Unknown devices accepted
- **No real-time** - Batch file upload only
- **No protocol support** - Only CSV/JSON, not ZK/Anviz/etc.
- **No sync status** - No dashboard for device health

**Device Protocols Needed**:
- **ZKTeco** (TCP/UDP, SOAP)
- **Anviz** (CrossChex)
- **Suprema** (BioStar 2)
- **HID Global** (Mercury)
- **Generic** (CSV, JSON, HTTP)

**Recommended Architecture**:
```
Device → Device Gateway (Node.js/Go) → Message Queue → API → Database
                    ↓
              Device Registry
              Health Monitoring
              Protocol Translation
```

**Immediate Fixes**:
1. Add API key authentication per device
2. Register devices in database
3. Validate payload structure
4. Add sync status dashboard

---

### INT-003: File Storage (MISSING)

**Current**: Database BLOB storage (Base64 in some cases)

**Required For**:
- Employee documents (visa, passport, Emirates ID scans)
- Company assets (logo, letterhead, stamp, signatures)
- Letter attachments
- Loan documents
- Service request attachments
- Payslip PDFs

**Recommended Solutions**:

| Option | Pros | Cons | Best For |
|--------|------|------|----------|
| **Cloudflare R2** | S3-compatible, no egress fees, CDN | Newer | Cost-sensitive |
| **AWS S3** | Mature, features, regions | Egress costs | Enterprise |
| **Supabase Storage** | Integrated, Postgres, signed URLs | Vendor lock-in | Supabase users |
| **Azure Blob** | Azure integration, tiers | Complex pricing | Microsoft shops |
| **Local + Nginx** | Free, control | No CDN, scaling | On-premise |

**Implementation Pattern**:
```typescript
// lib/integrations/storage.ts
export async function uploadFile(
  file: File,
  path: string,
  options: { contentType: string; metadata?: Record<string, string> }
) {
  const buffer = await file.arrayBuffer()
  const key = `${path}/${crypto.randomUUID()}-${file.name}`
  
  await s3Client.send(new PutObjectCommand({
    Bucket: process.env.STORAGE_BUCKET,
    Key: key,
    Body: Buffer.from(buffer),
    ContentType: options.contentType,
    Metadata: options.metadata
  }))
  
  return { key, url: await getSignedUrl(key) }
}

export async function getSignedUrl(key: string, expiresIn = 3600) {
  return s3Client.send(new GetObjectCommand({
    Bucket: process.env.STORAGE_BUCKET,
    Key: key
  }), { expiresIn })
}
```

---

### INT-004: PDF Generation (PASS)

**Current**: Assumed `pdf-lib` or `jspdf` for:
- Payslips
- Letters (Offer, Appointment, Relieving, Salary Certificate, NOC)
- Attendance reports
- Payroll reports

**Features Needed**:
- Arabic RTL support
- Digital stamp/signature overlay
- A4 page format
- Watermark (COPY, CONFIDENTIAL)
- Password protection (sensitive docs)
- Batch generation

**Libraries**:
- **pdf-lib** (Recommended - modify existing PDFs)
- **@react-pdf/renderer** (React components to PDF)
- **puppeteer** (HTML to PDF, heavy)
- **jspdf** (Client-side, limited)

---

### INT-005: Digital Stamp & Signature (PARTIAL)

**Current**: Static image files in `/public/assets/`
- `stamp.png`
- `signature.png`
- `letterhead.png`

**Issues**:
- No upload/management UI
- No versioning
- No access control
- Fixed positions in PDF

**Required**:
1. Upload/replace via Settings
2. Position configuration (X, Y, scale per template)
3. Transparency support (PNG)
3. Multiple signatures (HR, Manager, CEO)
4. Audit trail on change

---

### INT-006: UAE WPS / Bank Integration (MISSING)

**Required For**:
- Salary transfer (WPS SIF format)
- Bank file generation (CSV/XML per bank)
- Payment confirmation reconciliation

**UAE WPS SIF Format**:
```
SIF Header: EMPLOYER_CODE, PERIOD, TOTAL_EMPLOYEES, TOTAL_AMOUNT
SIF Detail: EMPLOYEE_CODE, BANK_CODE, ACCOUNT_NUMBER, NET_SALARY, CURRENCY
SIF Trailer: TOTAL_RECORDS, TOTAL_AMOUNT
```

**Bank-Specific Formats**:
- **Emirates NBD**: CSV with specific columns
- **ADCB**: Excel with formatting
- **FAB**: XML ISO 20022
- **Mashreq**: CSV
- **DIB**: CSV

**Implementation**:
```typescript
// lib/integrations/wps.ts
export function generateWPSFile(payrollData: PayrollRecord[]): string {
  // Generate SIF format per UAE Central Bank spec
}

export function generateBankFile(bankCode: string, payrollData: PayrollRecord[]): string {
  const formatters = {
    'ENBD': formatENBD,
    'ADCB': formatADCB,
    'FAB': formatFAB,
    // ...
  }
  return formatters[bankCode]?.(payrollData) || generateCSV(payrollData)
}
```

---

### INT-007: Government Portal Integration (MISSING)

**Portals**:
- **MOHRE** (Ministry of Human Resources) - Contracts, work permits
- **GDRFA** (General Directorate of Residency) - Visas, Emirates ID
- **ICA** (Federal Authority for Identity) - Emirates ID
- **E-Channels** - Labour card, work permits

**API Availability**: Limited, mostly manual/portal-based

**Workaround**: Document generation for manual submission

---

### INT-008: OAuth Providers (CONFIGURED)

| Provider | Status | Env Vars | Scopes |
|----------|--------|----------|--------|
| Google | Code ready | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | email, profile |
| Microsoft Entra ID | Code ready | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` | User.Read |

**Issues**:
- **Not configured** - Placeholder env vars
- No domain restriction (Microsoft)
- No group/role sync

**Fix**: Configure in provider consoles, add env vars

---

### INT-009: Calendar/ICS Export (MISSING)

**Use Cases**:
- Leave calendar (employee)
- Shift calendar (employee)
- Company holidays (all)
- Meeting invites (approvals)

**Implementation**:
```typescript
// lib/integrations/ics.ts
export function generateICS(events: CalendarEvent[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HRMS//EN',
    ...events.map(e => [
      'BEGIN:VEVENT',
      `UID:${e.id}@hrms`,
      `DTSTAMP:${formatDate(new Date())}`,
      `DTSTART:${formatDate(e.start)}`,
      `DTEND:${formatDate(e.end)}`,
      `SUMMARY:${e.title}`,
      `DESCRIPTION:${e.description}`,
      `LOCATION:${e.location || ''}`,
      'END:VEVENT'
    ]).join('\n'),
    'END:VCALENDAR'
  ].join('\n')
}
```

---

### INT-010: Slack/Teams/Webhooks (MISSING)

**Use Cases**:
- Critical alerts (visa expiry, payroll lock)
- Approval requests (with action buttons)
- Daily summaries
- System health alerts

**Implementation**:
```typescript
// lib/integrations/slack.ts
export async function sendSlackAlert(channel: string, message: SlackMessage) {
  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, ...message })
  })
}
```

---

## Integration Security

| Integration | Auth Method | Encryption | Rate Limit | Audit |
|-------------|-------------|------------|------------|-------|
| Email | API Key | TLS | Provider | Provider |
| Biometric | **NONE** | TLS | **NONE** | **NONE** |
| File Storage | Signed URLs | TLS/SSE | Bucket Policy | CloudTrail |
| PDF Generation | Internal | N/A | N/A | Internal |
| WPS/Bank | SFTP/VPN | TLS/VPN | Bank | Bank |
| Government | Portal | TLS | Portal | Portal |
| OAuth | OAuth 2.0 | TLS | Provider | NextAuth |
| Webhooks | HMAC/Signature | TLS | Config | Internal |

---

## Integration Testing

| Integration | Unit Tests | Integration Tests | Contract Tests | Monitoring |
|-------------|------------|-------------------|----------------|------------|
| Email | NO | NO | NO | NO |
| Biometric | NO | NO | NO | NO |
| File Storage | NO | NO | NO | NO |
| PDF Generation | NO | NO | NO | NO |
| WPS/Bank | NO | NO | NO | NO |
| OAuth | NO | NO | NO | NextAuth |
| Calendar | NO | NO | NO | NO |
| Slack | NO | NO | NO | NO |

---

## Recommendations

### Immediate (Week 1)
1. **Secure biometric endpoint** with API keys
2. **Implement email** with Resend/SendGrid
3. **Configure OAuth** providers

### Short-term (Week 2)
4. **Implement file storage** (R2/S3)
5. **Add WPS/bank export** for payroll
6. **Implement calendar/ICS** export

### Medium-term (Week 3-4)
7. **Digital stamp management** UI
8. **SMS integration** (Twilio/local)
9. **Slack/Teams webhooks** for alerts
10. **Government portal** document generation
11. **Webhook system** for external integrations
12. **Integration testing** framework