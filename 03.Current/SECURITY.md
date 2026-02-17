# Security Policy - Prix Six

**Last Updated:** 2026-02-13 (v1.57.2)
**Status:** Production-Ready Security Posture

---

## Reporting Security Issues

If you discover a security vulnerability in Prix Six, please report it to:

**Email:** aaron@garcia.ltd
**Subject Line:** [SECURITY] Prix Six Vulnerability Report

**Please include:**
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if known)

**Response Time:** We aim to respond within 48 hours and provide a fix within 7 days for critical issues.

---

## Current Security Posture

### ✅ Implemented Security Controls

#### Authentication & Authorization
- ✅ Firebase Authentication with email/password and OAuth (Google, Apple)
- ✅ Admin verification via time-limited magic links (httpOnly cookies)
- ✅ Progressive account lockout (5/10/15 failed attempts)
- ✅ Session management with presence tracking
- ✅ Admin-only API endpoints with token verification
- ✅ Ownership validation on all user operations

#### Data Protection
- ✅ All credentials masked in logs (PINs shown as ••••••)
- ✅ No sensitive data in error messages
- ✅ Correlation IDs use crypto.randomUUID() (not Math.random())
- ✅ Service account validation in WhatsApp worker
- ✅ CSRF protection on authentication endpoints (Origin/Referer validation)

#### XSS Prevention
- ✅ DOMPurify sanitization on all user-controlled HTML
- ✅ HTML escaping in email templates (escapeHtml() function)
- ✅ AI-generated content sanitized with bleach library (Python)
- ✅ Admin UI protected against team name XSS

#### Infrastructure Security
- ✅ Health check endpoint for monitoring (`/api/health`)
- ✅ CI/CD pipeline with security scanning (Semgrep)
- ✅ Production safety checks on all destructive scripts
- ✅ Secrets management abstraction (Azure Key Vault ready)
- ✅ Error handling with correlation ID tracking (100% API compliance)

#### Operational Security
- ✅ Firestore security rules enforce authorization
- ✅ Rate limiting on email broadcasts (1 hour cooldown)
- ✅ Audit logging for admin actions
- ✅ Attack detection and monitoring (`attack_alerts` collection)

---

## Security Architecture

### Authentication Flow

```
1. User Login (email/password or OAuth)
   ↓
2. Firebase Auth verification
   ↓
3. Firestore user document lookup
   ↓
4. Account lockout check (lockedUntil field)
   ↓
5. Session creation (JWT token)
   ↓
6. Audit log entry
```

### Admin Verification Flow

```
1. Admin triggers verification request
   ↓
2. Server generates crypto-random token (32 bytes)
   ↓
3. Token stored in admin_verification_tokens (15min expiry)
   ↓
4. Magic link sent via email
   ↓
5. User clicks link → token validated (constant-time comparison)
   ↓
6. httpOnly adminVerified cookie set (24 hour expiry)
   ↓
7. Server Component reads cookie, passes verification status to client
```

### API Request Security

```
1. Client sends request with Authorization: Bearer <token>
   ↓
2. Server calls verifyAuthToken(authHeader)
   ↓
3. If admin required: Check users/{uid}.isAdmin
   ↓
4. If ownership required: Validate uid matches resource owner
   ↓
5. Generate correlationId for request tracking
   ↓
6. Execute business logic
   ↓
7. On error: logTracedError() with correlation ID
   ↓
8. Return response (never expose raw error.message)
```

---

## Security Best Practices for Developers

### Golden Rules for Security

**Rule #1: 4-Pillar Error Handling**
Every error must have:
1. Error log (logTracedError)
2. Error type/code (ERRORS.KEY from registry)
3. Correlation ID (generateCorrelationId)
4. Selectable display (no raw error.message)

**Rule #7: Error Registry Compliance**
Use only `ERRORS.KEY` from `@/lib/error-registry.ts` - never hardcode error messages.

**Rule #11: Security Review Before Commit**
Ask these 5 questions before every commit:
1. Does this expose any credentials or PII?
2. Does this validate all user input?
3. Does this check authorization before allowing access?
4. Does this prevent race conditions?
5. Does this log errors with correlation IDs?

### Code Patterns

#### ✅ Safe Pattern: Authentication
```typescript
const authHeader = request.headers.get('Authorization');
const verifiedUser = await verifyAuthToken(authHeader);

if (!verifiedUser) {
  return NextResponse.json(
    { success: false, error: 'Unauthorized', correlationId },
    { status: 401 }
  );
}

// For admin endpoints, add:
const userDoc = await db.collection('users').doc(verifiedUser.uid).get();
if (!userDoc.exists || !userDoc.data()?.isAdmin) {
  return NextResponse.json(
    { success: false, error: 'Admin access required', correlationId },
    { status: 403 }
  );
}
```

#### ✅ Safe Pattern: User Input Sanitization
```typescript
// For HTML content:
import DOMPurify from 'isomorphic-dompurify';
<div dangerouslySetInnerHTML={{
  __html: DOMPurify.sanitize(userContent)
}} />

// For email templates:
import { escapeHtml } from '@/lib/email';
<p>Hello <strong>${escapeHtml(teamName)}</strong></p>

// For AI-generated content (Python):
import bleach
safe_html = bleach.clean(ai_html, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRS)
```

#### ✅ Safe Pattern: Error Handling
```typescript
import { createTracedError, logTracedError } from '@/lib/traced-error';
import { ERRORS } from '@/lib/error-registry';
import { generateCorrelationId } from '@/lib/firebase-admin';

const correlationId = generateCorrelationId();

try {
  // ... operation
} catch (error: any) {
  const { db } = await getFirebaseAdmin();
  const traced = createTracedError(ERRORS.UNKNOWN_ERROR, {
    correlationId,
    context: { route: '/api/your-route', action: 'POST' },
    cause: error instanceof Error ? error : undefined,
  });
  await logTracedError(traced, db);

  return NextResponse.json(
    {
      success: false,
      error: traced.definition.message,  // Safe, never raw error.message
      errorCode: traced.definition.code,
      correlationId: traced.correlationId,
    },
    { status: 500 }
  );
}
```

#### ✅ Safe Pattern: Race Condition Prevention
```typescript
// Use .create() instead of .set() for atomic document creation
try {
  await db.collection('users').doc(uid).create(newUser);
} catch (createError: any) {
  if (createError.code === 6 || createError.message?.includes('already exists')) {
    return NextResponse.json({ error: 'Already exists' }, { status: 409 });
  }
  throw createError;
}
```

#### ❌ Unsafe Patterns to Avoid

```typescript
// ❌ NEVER expose raw error messages
catch (error) {
  return NextResponse.json({ error: error.message }, { status: 500 });
}

// ❌ NEVER use Math.random() for security
const token = Math.random().toString(36);

// ❌ NEVER skip authentication on admin endpoints
export async function POST(request: NextRequest) {
  // Missing: await verifyAuthToken(request.headers.get('Authorization'))
  const { db } = await getFirebaseAdmin();
  await db.collection('admin_configuration').doc('settings').update(data);
}

// ❌ NEVER trust client-provided IDs without validation
const { userId } = await request.json();
await db.collection('users').doc(userId).update(data);
// Missing: Verify userId === verifiedUser.uid

// ❌ NEVER use .set() when atomic creation is required
const existingDoc = await db.collection('users').doc(uid).get();
if (existingDoc.exists) return; // RACE CONDITION!
await db.collection('users').doc(uid).set(newUser);
// Use .create() instead
```

---

## Security Testing

### Pre-Deployment Checklist

- [ ] All environment variables documented in `.env.example`
- [ ] No secrets committed to git (check with `git log --all -S "secret"`)
- [ ] All API routes require authentication (if not public)
- [ ] All admin endpoints verify `isAdmin` field
- [ ] All errors logged with correlation IDs
- [ ] All user input sanitized before rendering
- [ ] Golden Rule #2: Version bumped in package.json AND version.ts
- [ ] Golden Rule #11: Security review completed (5 questions)

### Manual Security Tests

**XSS Testing:**
```typescript
// Test payload in all user input fields:
<script>alert('xss')</script>
<img src=x onerror="alert('xss')">

// Expected: Rendered as text or stripped, never executed
```

**Authentication Testing:**
```bash
# Test unauthenticated access to admin endpoints
curl -X POST https://prix6.win/api/admin/update-site-functions \
  -H "Content-Type: application/json" \
  -d '{"loginEnabled": false}'

# Expected: 401 Unauthorized
```

**Authorization Testing:**
```bash
# Test cross-user access (user A tries to modify user B's data)
curl -X POST https://prix6.win/api/update-secondary-email \
  -H "Authorization: Bearer <user_a_token>" \
  -H "Content-Type: application/json" \
  -d '{"uid": "<user_b_uid>", "email": "attacker@example.com"}'

# Expected: 403 Forbidden
```

**Race Condition Testing:**
```bash
# Send 10 concurrent OAuth profile completion requests
for i in {1..10}; do
  curl -X POST https://prix6.win/api/auth/complete-oauth-profile \
    -H "Authorization: Bearer <token>" \
    -H "Content-Type: application/json" \
    -d '{"uid": "123", "teamName": "Test", "email": "test@example.com"}' &
done
wait

# Expected: 9 requests return 409 Conflict, 1 succeeds
```

---

## Incident Response

### Severity Levels

| Severity | Description | Response Time | Example |
|----------|-------------|---------------|---------|
| **Critical** | Active exploit, data breach | Immediate | SQL injection, credential leak |
| **High** | Potential exploit, auth bypass | 24 hours | XSS, CSRF, privilege escalation |
| **Medium** | Security weakness | 7 days | Missing rate limiting, weak validation |
| **Low** | Security improvement | 30 days | Better logging, documentation |

### Incident Response Procedure

1. **Detection**
   - Monitor `error_logs` collection for correlation ID spikes
   - Check `attack_alerts` collection for suspicious patterns
   - Review failed login attempts for brute-force attacks

2. **Containment**
   - Disable affected endpoints if necessary
   - Revoke compromised tokens
   - Lock affected user accounts

3. **Investigation**
   - Search logs by correlation ID
   - Check audit_logs for admin actions
   - Review Firestore security rules

4. **Remediation**
   - Apply security patch
   - Rotate compromised secrets
   - Update security rules

5. **Communication**
   - Notify affected users (if data breach)
   - Document incident in `SECURITY-INCIDENTS.md`
   - Update security policies

---

## Monitoring & Alerts

### Key Metrics to Monitor

**Authentication:**
- Failed login attempts (threshold: >10/minute from single IP)
- Account lockouts (threshold: >5/hour)
- Admin verification failures (threshold: >3/hour)

**API Security:**
- 401 Unauthorized responses (threshold: >100/minute)
- 403 Forbidden responses (threshold: >50/minute)
- 500 Internal Server errors (threshold: >10/minute)

**Data Protection:**
- Error logs with exposed credentials (manual review weekly)
- Firestore rule violations (automatic alert)
- WhatsApp worker authentication failures (threshold: >5/hour)

### Alert Configuration

```typescript
// Example: Monitor failed logins in Cloud Function
export const monitorFailedLogins = functions.firestore
  .document('audit_logs/{logId}')
  .onCreate(async (snap) => {
    const log = snap.data();
    if (log.action === 'LOGIN_FAILED') {
      // Check rate in last minute
      const recentFails = await db.collection('audit_logs')
        .where('action', '==', 'LOGIN_FAILED')
        .where('timestamp', '>', new Date(Date.now() - 60000))
        .get();

      if (recentFails.size > 10) {
        await db.collection('attack_alerts').add({
          type: 'BRUTE_FORCE_ATTEMPT',
          timestamp: FieldValue.serverTimestamp(),
          details: { count: recentFails.size }
        });
      }
    }
  });
```

---

## Dependency Security

### Required Security Dependencies

**Node.js:**
- `isomorphic-dompurify` - XSS prevention (client + server)
- `@azure/identity` - Secure Azure authentication
- `firebase-admin` - Server-side Firebase SDK

**Python:**
- `bleach` - HTML sanitization for AI-generated content

### Update Policy

- Run `npm audit` before every deployment
- Fix high/critical vulnerabilities immediately
- Review medium/low vulnerabilities monthly
- Keep all dependencies within 6 months of latest version

### Vulnerability Scanning

```bash
# Node.js
npm audit
npm outdated

# Python
pip list --outdated
pip-audit

# CI/CD (Semgrep)
semgrep --config auto .
```

---

## Compliance & Privacy

### Data Retention

- **User accounts:** Indefinite (until user requests deletion)
- **Audit logs:** 90 days
- **Error logs:** 30 days
- **Email logs:** 90 days
- **Attack alerts:** 1 year

### User Rights

**Right to Access:**
- Users can export their data via admin panel

**Right to Deletion:**
- Users can request account deletion via email
- Cascade delete: predictions, scores, league memberships

**Right to Rectification:**
- Users can update team name, secondary email via UI

---

## Security Updates

**Current Version:** 1.57.2
**Last Security Audit:** 2026-02-13

### Recent Security Patches

| Version | Date | CVE / Issue | Fix |
|---------|------|-------------|-----|
| 1.57.2 | 2026-02-13 | AUTH-003 | OAuth race condition + performance fix |
| 1.57.2 | 2026-02-13 | GEMINI-003 | AI HTML sanitization with bleach |
| 1.57.1 | 2026-02-13 | DEPLOY-003 | Script safety checks for production |
| 1.57.0 | 2026-02-13 | Multiple | Health check, CI/CD, secrets manager |
| 1.55.18 | 2026-02-13 | Signup performance | Indexed queries for team name check |
| 1.55.0 | 2026-02-10 | EMAIL-006 | PIN masking in email logs |
| 1.55.0 | 2026-02-10 | GEMINI-AUDIT-006 | Unauthenticated secondary email API |

### Upcoming Security Work

1. **Manual Infrastructure Tasks** (Priority: HIGH)
   - Remove service account keys from git history
   - Rotate Microsoft Graph API secret
   - Rotate WhatsApp app secret
   - Configure Azure Key Vault

2. **Third-Party Audit** (Priority: MEDIUM)
   - Penetration testing
   - OWASP ZAP automated scanning
   - Code review by external security firm

---

**For questions or security concerns, contact:** aaron@garcia.ltd

**Last reviewed by:** Claude Sonnet 4.5 (Bill)
**Next review due:** 2026-03-13 (30 days)
