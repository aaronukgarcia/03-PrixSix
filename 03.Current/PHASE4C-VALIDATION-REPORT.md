# Phase 4.C: Validation Issues Report

**Date:** 2026-02-13
**Version:** 1.57.1
**Reviewer:** Claude Sonnet 4.5 (Bill)

## Executive Summary

Investigated 5 remaining validation issues from the security plan. **4 issues are already resolved**, **1 issue requires fixes**, and **1 issue was discovered during investigation**.

### Status Summary

| Issue | Severity | Status | Action Required |
|-------|----------|--------|-----------------|
| EMAIL-001 | Medium | ✅ RESOLVED | None - HTML escaping implemented |
| EMAIL-002 | Medium | ✅ RESOLVED | None - All URLs hardcoded |
| ADMIN-005 | Low | ✅ RESOLVED | None - Invite codes masked |
| WHATSAPP-004 | Medium | ✅ RESOLVED | None - Validation implemented |
| AUTH-003 | Medium | ⚠️ NEEDS FIX | Fix OAuth race condition + performance |
| GEMINI-003 | Medium | ⚠️ NEEDS FIX | Sanitize AI-generated HTML |

---

## Issue Details

### ✅ EMAIL-001: Email Content Safety (HTML Injection)

**Status:** RESOLVED
**Location:** `app/src/lib/email.ts`

**Finding:**
- HTML escaping function implemented (lines 37-45)
- User-controlled data properly escaped before insertion into email templates:
  - Team names: `${escapeHtml(teamName)}` (line 194)
  - PINs: `${escapeHtml(pin)}` (line 199)
- GUID documentation confirms this resolves CVSS 7.5 XSS vulnerability

**Evidence:**
```typescript
export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\//g, '&#x2F;');
}
```

**Conclusion:** No action required. All user-controlled content in emails is sanitized.

---

### ✅ EMAIL-002: Email URL Validation

**Status:** RESOLVED
**Location:** `app/src/lib/email.ts`

**Finding:**
All URLs in email templates are **hardcoded constants**, not dynamically constructed from user input:
- Line 202: `https://prix6.win/login` (hardcoded)
- Line 215: `mailto:aaron@garcia.ltd` (hardcoded)
- Line 226: `mailto:aaron@garcia.ltd` (hardcoded)
- Line 360: `mailto:aaron@garcia.ltd` (hardcoded)

**Evidence:**
```html
<a href="https://prix6.win/login" class="cta-button">Log In Now</a>
```

**Conclusion:** No URL injection vulnerability exists. All URLs are static and controlled by developers.

---

### ✅ ADMIN-005: Invite Code Visibility

**Status:** RESOLVED (Security Fix Already Applied)
**Location:** `app/src/app/(app)/admin/_components/LeaguesManager.tsx`

**Finding:**
- Invite codes are **masked** in the admin UI (line 136)
- Previous copy-to-clipboard functionality was **removed** for security
- GUID comment confirms this was ADMIN-005 fix

**Evidence:**
```tsx
// Line 136 - Invite codes displayed as dots
<code className="text-sm bg-muted px-2 py-0.5 rounded text-muted-foreground">
  ••••••••
</code>

// Lines 71-74 - Documentation of security fix
// [Intent] REMOVED - Invite codes are now masked for security (ADMIN-005 fix).
// Previous functionality: Copied league invite codes to clipboard.
// [Security] Displaying and copying private league invite codes in admin panel enabled
// unauthorized access. Codes are now masked with ••••••••.
```

**Conclusion:** Intentional security feature. Admins can see that a code exists but cannot view or copy the actual code value. This prevents shoulder-surfing and accidental exposure.

---

### ✅ WHATSAPP-004: Service Account Validation

**Status:** RESOLVED
**Location:** `whatsapp-worker/src/firebase-config.ts`

**Finding:**
Service account JSON validation is implemented with proper error handling:
- JSON parsing wrapped in try/catch (lines 19-24)
- Required fields validated: `project_id`, `private_key`, `client_email` (lines 27-32)
- Error messages don't expose credential content (security-safe)

**Evidence:**
```typescript
// Lines 19-24 - Safe JSON parsing
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} catch (error: any) {
  // SECURITY: Don't expose the env var content in error message
  throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON. Check environment variable format.');
}

// Lines 27-32 - Field validation
const requiredFields = ['project_id', 'private_key', 'client_email'];
const missingFields = requiredFields.filter(field => !serviceAccount[field]);

if (missingFields.length > 0) {
  throw new Error(`FIREBASE_SERVICE_ACCOUNT is missing required fields: ${missingFields.join(', ')}`);
}
```

**Conclusion:** Proper validation implemented. Prevents crashes from malformed service account JSON.

---

### ⚠️ AUTH-003: OAuth Race Condition + Performance Issue

**Status:** NEEDS FIX (2 issues discovered)
**Location:** `app/src/app/api/auth/complete-oauth-profile/route.ts`

#### Issue 1: TOCTOU Race Condition

**Problem:**
Classic Time-of-Check-Time-of-Use race condition between lines 141-152 (check) and line 228 (create):

```typescript
// Line 141-152: Check if doc exists
const existingDoc = await db.collection('users').doc(uid).get();
if (existingDoc.exists) {
  return NextResponse.json({ ... }, { status: 409 });
}

// ... other validation ...

// Line 228: Create doc (race window here!)
await db.collection('users').doc(uid).set(newUser);
```

**Race Scenario:**
1. Request A checks `existingDoc.exists` → false
2. Request B checks `existingDoc.exists` → false (before A creates)
3. Request A creates document
4. Request B overwrites document (data loss!)

**Impact:**
- Low probability (requires exact concurrent timing)
- High severity (could overwrite user data, create duplicate league memberships)

**Fix Required:**
Use Firestore transaction or check for already-exists error after set:
```typescript
// Option 1: Transaction
await db.runTransaction(async (transaction) => {
  const doc = await transaction.get(userRef);
  if (doc.exists) throw new Error('Already exists');
  transaction.set(userRef, newUser);
});

// Option 2: Create instead of set
await db.collection('users').doc(uid).create(newUser);
// Throws error if doc already exists
```

#### Issue 2: Performance Bottleneck (Same as fixed in signup route)

**Problem:**
Line 159 fetches **ALL users** from Firestore for team name check:
```typescript
const allUsersSnapshot = await db.collection('users').get(); // ⚠️ SLOW!
```

**Impact:**
- Same issue fixed in signup route (v1.55.18)
- 5-30 second hang on large user collections
- Scales O(n) with user count

**Fix Required:**
Use indexed queries on `teamNameLower` (same pattern as signup fix):
```typescript
// Replace getAllUsers() with parallel indexed queries
const [primaryMatch, secondaryMatch] = await Promise.all([
  db.collection('users')
    .where('teamNameLower', '==', normalizedNewName)
    .limit(1)
    .get(),
  db.collection('users')
    .where('secondaryTeamNameLower', '==', normalizedNewName)
    .limit(1)
    .get()
]);

const teamNameExists = !primaryMatch.empty || !secondaryMatch.empty;
```

**Prerequisites:**
- Add `teamNameLower` field to user documents (already done in signup route)
- Deploy Firestore composite indexes (should already exist from signup fix)

---

### ⚠️ GEMINI-003: AI-Generated HTML Sanitization

**Status:** NEEDS FIX
**Location:** `prix_six_engine.py`

**Problem:**
AI-generated HTML from Gemini 1.5 Pro is inserted directly into templates without sanitization:

```python
# Line 426 - prix_six_engine.py
def build_html(body_html: str) -> str:
    date_str = datetime.date.today().strftime("%d %B %Y")
    return textwrap.dedent(f"""
        <!DOCTYPE html>
        <html lang="en">
        ...
        <p class="date">{html.escape(date_str)}</p>
        {body_html}  # ⚠️ NOT ESCAPED - AI-generated content inserted raw!
        ...
    """)
```

**Risk Assessment:**

**High Risk If:**
- Content displayed to regular users without admin authentication
- Stored XSS could affect all users viewing newsletters

**Medium Risk If:**
- Only displayed to admins in admin panel
- Self-XSS scenario (admin generates and views own content)

**Low Risk If:**
- Never displayed in browser (email-only or PDF generation)

**Recommended Fix:**

Even though AI is prompted to generate HTML, defense-in-depth requires sanitization:

**Option 1: Python HTML Sanitizer (Recommended)**
```python
import bleach

ALLOWED_TAGS = ['p', 'h1', 'h2', 'h3', 'strong', 'em', 'ul', 'ol', 'li', 'br', 'a']
ALLOWED_ATTRS = {'a': ['href', 'title']}

def sanitize_ai_html(unsafe_html: str) -> str:
    """Sanitize AI-generated HTML to prevent XSS."""
    return bleach.clean(
        unsafe_html,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRS,
        strip=True  # Remove disallowed tags instead of escaping
    )

# Apply before insertion:
{sanitize_ai_html(body_html)}
```

**Option 2: Client-Side Sanitization (If displayed in browser)**
```tsx
import DOMPurify from 'isomorphic-dompurify';

<div dangerouslySetInnerHTML={{
  __html: DOMPurify.sanitize(aiGeneratedHtml)
}} />
```

**Option 3: Markdown Output (Architecture Change)**
- Change AI prompt to generate Markdown instead of HTML
- Use Python `markdown` library to convert to HTML
- Markdown is inherently safer (no script tags)

**Installation Required (Option 1):**
```bash
pip install bleach
```

**Severity:** Medium
- AI unlikely to generate malicious code unprompted
- But adversarial inputs to AI (via RSS feeds) could inject XSS payloads
- Defense-in-depth principle requires sanitization

---

## Recommendations

### Immediate Actions Required

1. **Fix AUTH-003 Race Condition:**
   - **Priority:** HIGH
   - **Effort:** 2 hours
   - **Files:** `app/src/app/api/auth/complete-oauth-profile/route.ts`
   - **Solution:** Replace `.set()` with `.create()` or use transaction
   - **Solution:** Replace `allUsersSnapshot` with indexed queries (copy pattern from signup route)
   - **Testing:** Concurrent request simulation

2. **Fix GEMINI-003 HTML Sanitization:**
   - **Priority:** MEDIUM
   - **Effort:** 1 hour
   - **Files:** `prix_six_engine.py`
   - **Solution:** Add `bleach.clean()` before HTML insertion
   - **Dependencies:** `pip install bleach`
   - **Testing:** Inject `<script>alert('xss')</script>` in AI prompt and verify removal

### Deferred Actions (Phase 3 Prerequisites)

**Tasks #1, #2, #3** remain pending from Phase 3 (require manual Azure work):
- Remove service account keys from filesystem
- Rotate Microsoft Graph API secret
- Rotate WhatsApp app secret

These are **prerequisites** for Phase 3 completion but don't block Phase 4 validation fixes.

---

## Conclusion

**Phase 4.C Progress:**
- ✅ 4/5 issues already resolved (EMAIL-001, EMAIL-002, ADMIN-005, WHATSAPP-004)
- ⚠️ 1/5 issues require fixes (AUTH-003 - actually 2 issues)
- ⚠️ 1 bonus issue discovered (GEMINI-003)

**Total Issues to Fix:** 3
1. AUTH-003a: OAuth race condition (transaction or .create())
2. AUTH-003b: OAuth performance bottleneck (indexed queries)
3. GEMINI-003: AI-generated HTML sanitization (bleach library)

**Estimated Time:** 3-4 hours total

**Next Step:** Implement fixes for AUTH-003 and GEMINI-003, then proceed to Phase 4.D (Final Security Audit).

---

**Generated:** 2026-02-13
**Tool:** Claude Sonnet 4.5 (Phase 4.C Validation)
**Related:** Phase 4.C completion gates Phase 4.D (Final Audit + Documentation)
