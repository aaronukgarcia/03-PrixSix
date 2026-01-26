# Login Bug Test Cases - v1.23.11

These test cases verify the fixes for login issues reported by users.

---

## Pre-requisites
- Access to a valid test account (email + PIN)
- Browser DevTools available (F12)
- Ability to throttle network (DevTools > Network > Throttle)

---

## Bug #1: Double Login Required

**Description:** Users have to log in twice before successfully entering the app.

### Test Case 1.1: Normal Login Flow
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/login` | Login page displays |
| 2 | Enter valid email | Email field populated |
| 3 | Enter valid PIN | PIN field populated |
| 4 | Click "Sign In" | Button shows "Signing In..." |
| 5 | Wait for response | Dashboard loads in single attempt |
| **PASS** | Dashboard displays without requiring second login | |

### Test Case 1.2: Slow Network Login
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open DevTools > Network > Throttle to "Slow 3G" | Network throttled |
| 2 | Navigate to `/login` | Login page displays |
| 3 | Enter valid credentials and click "Sign In" | Button shows "Signing In..." |
| 4 | Wait (may take 5-10 seconds) | Loading state maintained |
| 5 | Eventually completes | Dashboard loads in single attempt |
| **PASS** | No double login required even on slow network | |

### Test Case 1.3: Double-Click Prevention
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/login` | Login page displays |
| 2 | Enter valid credentials | Fields populated |
| 3 | Rapidly double-click "Sign In" | Button disables after first click |
| 4 | Wait for response | Only one login attempt processed |
| **PASS** | Dashboard loads once, no duplicate requests | |

---

## Bug #2: Login Succeeds but Dashboard Doesn't Load (Needs F5)

**Description:** Login appears successful but dashboard shows loading skeleton indefinitely. User must press F5 to refresh.

### Test Case 2.1: Dashboard Loads After Login
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Clear browser cache/cookies for the site | Fresh state |
| 2 | Navigate to `/login` | Login page displays |
| 3 | Enter valid credentials and submit | "Signing In..." shown |
| 4 | Wait for redirect | Navigates to `/dashboard` |
| 5 | Observe dashboard | Content loads within 5 seconds |
| **PASS** | Dashboard content visible without F5 refresh | |

### Test Case 2.2: Slow Firestore Response
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open DevTools > Network > Throttle to "Slow 3G" | Network throttled |
| 2 | Login with valid credentials | Login processes |
| 3 | Observe dashboard loading | Skeleton may show briefly |
| 4 | Wait up to 15 seconds | Dashboard eventually loads |
| **PASS** | Dashboard loads without manual refresh | |

### Test Case 2.3: Error State Display
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Login with valid credentials | Dashboard loads |
| 2 | Open DevTools > Network > Set "Offline" | Network disabled |
| 3 | Refresh page (F5) | Error state should display |
| 4 | Observe error UI | Shows "Unable to Load Profile" message |
| 5 | Verify buttons present | "Refresh Page" and "Return to Login" buttons visible |
| **PASS** | Error UI displays instead of infinite skeleton | |

---

## Bug #3: Login Screen Remains (No Error Shown)

**Description:** User enters credentials, submits, but login screen just stays with no error message. User has to re-enter credentials.

### Test Case 3.1: Invalid Credentials Show Error
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `/login` | Login page displays |
| 2 | Enter valid email, wrong PIN | Fields populated |
| 3 | Click "Sign In" | "Signing In..." shown |
| 4 | Wait for response | Error message displayed |
| 5 | Observe error | Red error box with message and correlation ID |
| **PASS** | Error clearly shown, not silent failure | |

### Test Case 3.2: Network Timeout Shows Error
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open DevTools > Network > Set "Offline" | Network disabled |
| 2 | Navigate to `/login` (may need to be cached) | Login page displays |
| 3 | Enter credentials and submit | "Signing In..." shown |
| 4 | Wait up to 15 seconds | Timeout error displayed |
| 5 | Observe error message | Shows timeout message with PX-1007 code |
| **PASS** | Timeout produces visible error, not silent fail | |

### Test Case 3.3: Auth State Verification
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Login with valid credentials | Dashboard loads |
| 2 | Open browser console (F12 > Console) | Console visible |
| 3 | Type `firebase.auth().currentUser` | Returns user object (not null) |
| **PASS** | Firebase auth state properly set after login | |

---

## Regression Tests

### Test Case R.1: Logout Works Correctly
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Login successfully | Dashboard loads |
| 2 | Click logout (from sidebar or profile) | Redirects to `/login` |
| 3 | Try to navigate to `/dashboard` directly | Redirects back to `/login` |
| **PASS** | Logout clears auth state completely | |

### Test Case R.2: Session Persistence
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Login successfully | Dashboard loads |
| 2 | Close browser tab | Tab closed |
| 3 | Open new tab, navigate to `/dashboard` | Dashboard loads (session persisted) |
| **PASS** | Session persists across tabs | |

### Test Case R.3: Must Change PIN Flow
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Login with account that has `mustChangePin: true` | Login processes |
| 2 | Observe redirect | Redirects to `/profile` |
| 3 | PIN change UI displayed | Can change PIN |
| **PASS** | Must change PIN flow still works | |

---

## Error Codes Reference

| Code | Description |
|------|-------------|
| PX-1007 | Login timeout (15 second limit exceeded) |
| PX-1008 | Sign-in verification failed (auth.currentUser not set) |
| PX-1009 | Auth state timeout (onAuthStateChanged didn't settle) |

---

## Test Results Log

| Date | Tester | Version | Test Case | Result | Notes |
|------|--------|---------|-----------|--------|-------|
| | | 1.23.11 | | | |

