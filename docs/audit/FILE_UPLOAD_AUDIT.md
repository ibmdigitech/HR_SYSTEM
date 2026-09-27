# FILE UPLOAD AUDIT

## Upload Endpoints Inventory

| Endpoint | Method | Auth | File Types | Max Size | Validation | Storage | Status |
|----------|--------|------|------------|----------|------------|---------|--------|
| `/api/attendance/import` | POST | **NONE** | CSV, JSON | None | **NONE** | Database | **CRITICAL** |
| `/api/seed` | POST | **NONE** | N/A | None | **NONE** | Database | **CRITICAL** |
| Bulk Employee Upload | Server Action | ADMIN/HR | CSV | 5MB | Extension only | Database | PARTIAL |
| Letter Attachments | Server Action | ADMIN/HR | Any | None | **NONE** | Local/DB | **FAIL** |
| Employee Documents | Server Action | ADMIN/HR | Any | None | **NONE** | Local/DB | **FAIL** |
| Company Logo | Server Action | ADMIN | Image | None | **NONE** | Local/DB | **FAIL** |
| HR Signature | Server Action | ADMIN | Image | None | **NONE** | Local/DB | **FAIL** |
| Letterhead | Server Action | ADMIN | Image/PDF | None | **NONE** | Local/DB | **FAIL** |
| Stamp/Signature | Server Action | ADMIN | Image | None | **NONE** | Local/DB | **FAIL** |
| Service Request Attachments | Server Action | All | Any | None | **NONE** | Local/DB | **FAIL** |
| Loan Documents | Server Action | All | Any | None | **NONE** | Local/DB | **FAIL** |

---

## Detailed Analysis

### FILE-001: Attendance Import (`/api/attendance/import`)

**Critical Issues**:
- **No authentication** - Public endpoint
- **No file type validation** - Accepts any file
- **No size limit** - DoS risk
- **No content validation** - Parses any CSV/JSON
- **No rate limiting** - Abuse potential
- **Direct database writes** - BiometricLog, Attendance

**Current Implementation**:
```typescript
// app/api/attendance/import/route.ts
export async function POST(request: Request) {
  const formData = await request.formData()
  const file = formData.get("file")
  // Parses CSV, creates BiometricLog/Attendance
  // NO AUTH CHECK
  // NO VALIDATION
}
```

**Required Fixes**:
1. Add API key authentication for devices
2. Validate file type (CSV only)
3. Add size limit (10MB)
4. Validate CSV structure
5. Add rate limiting (10 req/min per device)
6. Log all imports with device ID

---

### FILE-002: Seed Endpoint (`/api/seed`)

**Critical Issues**:
- **No authentication** - Public destructive endpoint
- **Runs database seed** - Creates/duplicates data
- **No confirmation** - Executes immediately
- **No audit log** - No trace of who triggered

**Current Implementation**:
```typescript
// app/api/seed/route.ts
export async function POST() {
  await seedDatabase() // Destructive
  return NextResponse.json({ success: true })
}
```

**Required Fixes**:
1. **REMOVE** or protect with secret token
2. If kept: Add ADMIN-only check
3. Add confirmation parameter
4. Audit log execution

---

### FILE-003: Bulk Employee Upload (Server Action)

**Location**: `app/lib/actions/bulk-upload.ts`

**Current Validation**:
```typescript
if (!file.name.endsWith('.csv')) {
  return { success: false, message: 'Please upload a CSV file only' }
}
if (file.size > 5 * 1024 * 1024) {
  return { success: false, message: 'File size must be less than 5MB' }
}
```

**Issues**:
- Only checks extension (not MIME type)
- No content validation
- No row limit
- No duplicate detection in file
- Partial failure handling shows only first 3 errors

**Required Fixes**:
1. Validate MIME type (`text/csv`, `application/csv`)
2. Parse and validate headers match template
3. Add row limit (1000 rows)
4. Preview step before commit
5. Better error reporting (all errors, downloadable)

---

### FILE-004: Letter Attachments & Templates

**Location**: `app/lib/actions/letters.ts`, `letter-templates.ts`

**Issues**:
- No file type validation
- No size limits
- Direct file system/database storage
- No virus scanning
- No access control on download

**Required Fixes**:
1. Validate types (PDF, DOCX, PNG, JPG for attachments)
2. Size limits (10MB attachments, 5MB templates)
3. Store in secure location (S3/Blob with signed URLs)
4. Access control on download (permission check)
5. Virus scanning integration

---

### FILE-005: Employee Documents (Visa, Passport, etc.)

**Location**: `app/lib/actions/employees.ts`, `visa.ts`

**Issues**:
- Documents stored as text fields (Emirates ID, Passport Number)
- No actual file upload for document copies
- No expiry alerts based on uploaded docs

**Required Fixes**:
1. Add file upload for document scans
2. Type validation (PDF, JPG, PNG)
3. Size limit (5MB per document)
4. Secure storage with access control
5. Link to VisaRequest for expiry tracking

---

### FILE-006: Company Assets (Logo, Letterhead, Stamp, Signature)

**Location**: `app/lib/actions/company-settings.ts`

**Issues**:
- No upload implementation (UI exists but no action)
- No image optimization
- No format validation
- No dimension validation

**Required Fixes**:
1. Implement upload actions
2. Validate: PNG/JPG/SVG, max 2MB
3. Dimensions: Logo 200x200, Letterhead 800x200, Stamp 300x300
4. Auto-optimize (WebP, resize)
4. CDN delivery

---

### FILE-007: Service Request Attachments

**Location**: `app/lib/actions/staff-requests.ts`

**Issues**:
- UI has file input but no upload action
- No validation
- No storage

**Required Fixes**:
1. Implement upload
2. Validate types per category (Receipts: PDF/JPG, Medical: PDF)
3. Size limits per category

---

## Security Vulnerabilities

| ID | Endpoint | Vulnerability | Severity |
|----|----------|---------------|----------|
| **FILE-001** | `/api/attendance/import` | Unauthenticated file upload | CRITICAL |
| **FILE-002** | `/api/seed` | Public destructive endpoint | CRITICAL |
| **FILE-003** | Bulk upload | Extension-only validation | HIGH |
| **FILE-004** | Letter attachments | No validation, no access control | HIGH |
| **FILE-005** | Employee documents | No file upload implemented | MEDIUM |
| **FILE-006** | Company assets | No upload implemented | MEDIUM |
| **FILE-007** | Service attachments | No upload implemented | MEDIUM |

---

## File Type Validation Matrix

| Category | Allowed Types | Max Size | Validation |
|----------|---------------|----------|------------|
| Attendance Import | CSV | 10MB | **NONE** |
| Employee Bulk | CSV | 5MB | Extension only |
| Letter Attachments | PDF, DOCX, PNG, JPG | 10MB | **NONE** |
| Letter Templates | DOCX, HTML | 5MB | **NONE** |
| Employee Documents | PDF, JPG, PNG | 5MB | **NONE** |
| Company Logo | PNG, JPG, SVG | 2MB | **NONE** |
| Letterhead | PNG, JPG, PDF | 5MB | **NONE** |
| HR Signature | PNG, JPG, SVG | 1MB | **NONE** |
| Stamp | PNG, JPG, SVG | 1MB | **NONE** |
| Service Attachments | PDF, JPG, PNG | 10MB | **NONE** |
| Loan Documents | PDF, JPG, PNG | 10MB | **NONE** |

---

## Storage Analysis

| Storage Type | Used For | Security | Backup |
|--------------|----------|----------|--------|
| Database (BLOB) | BiometricLog, some attachments | Medium | With DB |
| File System | **NOT IMPLEMENTED** | N/A | N/A |
| Cloud (S3/R2) | **NOT IMPLEMENTED** | N/A | N/A |

**Current**: Most files stored as Base64 in database or not implemented

**Recommendation**: 
1. Use cloud storage (S3, Cloudflare R2, Supabase Storage)
2. Generate signed URLs for access
3. Never serve files directly from database
4. Implement CDN for assets

---

## Access Control on Downloads

| File Type | Download Endpoint | Permission Check | Status |
|-----------|-------------------|------------------|--------|
| Payslips | `/api/payroll/export` | **NONE** | **FAIL** |
| Letters | `/api/letters` | **NONE** | **FAIL** |
| Attendance Export | `/api/attendance/download` | **NONE** | **FAIL** |
| Employee Export | `/api/employees` | **NONE** | **FAIL** |
| Employee Avatars | Direct URL | **NONE** | **FAIL** |

---

## Virus/Malware Scanning

**Status**: **NOT IMPLEMENTED**

**Recommendations**:
1. Integrate ClamAV or cloud scanning (AWS Lambda + ClamAV)
2. Scan on upload, quarantine if infected
3. Log all scans
4. Alert on detection

---

## Compliance (UAE)

| Requirement | Status | Gap |
|-------------|--------|-----|
| Document retention (5 years) | PARTIAL | No retention policy |
| Encrypted storage | **NO** | Database not encrypted |
| Access logging | PARTIAL | Only AuditLog for some |
| Data localization | **NO** | Cloud storage region? |

---

## Recommendations

### Immediate (Week 1)
1. **REMOVE `/api/seed`** or protect with secret
2. **SECURE `/api/attendance/import`** with API key auth
3. Add MIME type validation to bulk upload
4. Add size limits to all endpoints

### Short-term (Week 2)
5. Implement file upload for Employee Documents
6. Implement Company Assets upload
7. Add access control to all download endpoints
8. Move storage to cloud (R2/S3)

### Medium-term (Week 3-4)
8. Virus scanning integration
9. Signed URL generation for downloads
10. Audit logging for all file operations
11. Retention policy implementation
12. Image optimization pipeline

---

## Testing Checklist

| Test | Status |
|------|--------|
| Upload valid CSV | PASS (bulk) |
| Upload invalid extension | PASS (blocked) |
| Upload > 5MB | PASS (blocked) |
| Upload CSV with wrong headers | **FAIL** (not validated) |
| Upload executable as .csv | **FAIL** (MIME not checked) |
| Download payslip without auth | **FAIL** (no check) |
| Upload 50MB file | **FAIL** (no limit on some) |
| Concurrent uploads | NOT TESTED |
| Malicious file upload | NOT TESTED |