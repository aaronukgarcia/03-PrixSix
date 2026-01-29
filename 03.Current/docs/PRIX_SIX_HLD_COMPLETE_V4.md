# Prix Six - Comprehensive High-Level Design Document

**Version:** 1.10.0
**Last Updated:** 21 January 2026
**Document Version:** 4.0 (Security Audit Edition)
**Authors:** Claude Code (AI-assisted documentation)

---

## ⚠️ SECURITY NOTICE

**This document includes a comprehensive security audit (Section 24) identifying critical vulnerabilities in the current implementation. The application is functional but NOT production-hardened. All identified gaps are documented with severity ratings and recommended remediations.**

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 4.0 | 21/01/2026 | Claude | Security audit: 6 critical/high vulnerabilities documented with remediations |
| 3.0 | 21/01/2026 | Claude | Deep technical audit: React patterns, AI flows, error handling, session management |
| 2.0 | 21/01/2026 | Claude | Full validation against codebase, 42 corrections applied |
| 1.0 | 20/01/2026 | Claude | Initial comprehensive HLD |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Authentication System](#4-authentication-system)
5. [User-Facing Pages](#5-user-facing-pages)
6. [Admin Dashboard](#6-admin-dashboard)
7. [Database Architecture](#7-database-architecture)
8. [Scoring System](#8-scoring-system)
9. [Email Notification System](#9-email-notification-system)
10. [WhatsApp Integration System](#10-whatsapp-integration-system)
11. [WhatsApp Worker Service](#11-whatsapp-worker-service)
12. [Consistency Checker](#12-consistency-checker)
13. [Audit System](#13-audit-system)
14. [Session Management System](#14-session-management-system)
15. [Error Handling Architecture](#15-error-handling-architecture)
16. [React Patterns & Custom Hooks](#16-react-patterns--custom-hooks)
17. [AI/Genkit Integration](#17-aigenkit-integration)
18. [Claude Coordination System](#18-claude-coordination-system)
19. [ID Conventions and Data Standards](#19-id-conventions-and-data-standards)
20. [Security Architecture](#20-security-architecture)
21. [Deployment Architecture](#21-deployment-architecture)
22. [API Reference](#22-api-reference)
23. [Environment Configuration](#23-environment-configuration)
24. [**SECURITY AUDIT: Known Gaps & Remediations**](#24-security-audit-known-gaps--remediations)
- [Appendix A: File Structure](#appendix-a-file-structure)
- [Appendix B: Version History](#appendix-b-version-history)
- [Appendix C: UI Components](#appendix-c-ui-components)
- [Appendix D: Utility Scripts](#appendix-d-utility-scripts)
- [Appendix E: Architectural Patterns](#appendix-e-architectural-patterns)
- [Appendix F: Type Definitions](#appendix-f-type-definitions)
- [Appendix G: Security Remediation Checklist](#appendix-g-security-remediation-checklist)

---

# 1. Executive Summary

## 1.1 Purpose

Prix Six is a fantasy Formula 1 prediction league application that enables approximately 20 players to compete by predicting the top 6 finishers for each F1 race. The application handles team registration, race predictions, automated scoring, league standings, and notifications via email and WhatsApp.

## 1.2 Key Features

| Feature | Description |
|---------|-------------|
| **User Registration** | PIN-based authentication with email |
| **Race Predictions** | Predict top 6 finishers before qualifying |
| **Automated Scoring** | Prix Six scoring rules (exact +5, wrong pos +3, bonus +10) |
| **Live Standings** | Real-time league leaderboard |
| **Email Notifications** | Welcome, results, hot news via Microsoft Graph |
| **WhatsApp Alerts** | Group notifications via WhatsApp Web automation |
| **Admin Dashboard** | 10-tab management interface |
| **AI Hot News** | Gemini-powered F1 news generation |
| **Single User Mode** | Admin-only session isolation |
| **Real-time Sync** | Firestore onSnapshot subscriptions |

## 1.3 Security Posture Summary

| Category | Status | Details |
|----------|--------|---------|
| **Authentication** | ⚠️ WEAK | 6-digit PIN, client-side lockout only |
| **Authorization** | 🔴 CRITICAL | Privilege escalation possible |
| **Data Integrity** | ⚠️ WEAK | Client-side scoring, no transactions |
| **API Security** | 🔴 CRITICAL | No caller identity verification |
| **Session Security** | ⚠️ COSMETIC | GUID tracking is display-only |

**See [Section 24](#24-security-audit-known-gaps--remediations) for full security audit.**

## 1.4 Target Users

- **Players:** ~20 members of a WhatsApp group
- **Admins:** Will and Aaron (developers/administrators)

## 1.5 Technical Summary

| Aspect | Technology |
|--------|------------|
| Frontend | Next.js 15, React 19, Tailwind CSS |
| Backend | Firebase (Firestore, Auth, Hosting) |
| Email | Microsoft Graph API (OAuth2 Client Credentials) |
| WhatsApp | whatsapp-web.js on Azure Container Instance |
| AI | Google Genkit with Gemini 2.5 Flash |
| Session Persistence | Azure Blob Storage |

---

# 2. System Architecture

## 2.1 High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PRIX SIX ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────────┐         ┌──────────────────────────────────────────┐ │
│   │                  │         │           FIREBASE PLATFORM              │ │
│   │   WEB BROWSER    │◄───────►│  ┌─────────────┐  ┌─────────────────┐   │ │
│   │   (React App)    │         │  │  Firebase   │  │    Firestore    │   │ │
│   │                  │         │  │    Auth     │  │    Database     │   │ │
│   └──────────────────┘         │  └─────────────┘  └─────────────────┘   │ │
│            │                   │         │                  │             │ │
│            │                   │  ┌─────────────────────────┘             │ │
│            │                   │  │                                       │ │
│            │                   │  │  ┌─────────────────────────────────┐ │ │
│            │                   │  │  │      Firebase App Hosting       │ │ │
│            └───────────────────┼──┼──│      (Next.js 15 SSR)           │ │ │
│                                │  │  └─────────────────────────────────┘ │ │
│                                └──┼──────────────────────────────────────┘ │
│                                   │                                        │
│   ┌───────────────────────────────┼────────────────────────────────────┐   │
│   │                               │         EXTERNAL SERVICES          │   │
│   │   ┌─────────────────┐   ┌────┴────────┐   ┌─────────────────────┐ │   │
│   │   │  Microsoft 365  │   │   Google    │   │   Azure Container   │ │   │
│   │   │  (Graph API)    │   │   Gemini    │   │   Instance          │ │   │
│   │   │                 │   │   (AI)      │   │                     │ │   │
│   │   │  📧 Email Send  │   │  🤖 Hot News│   │  📱 WhatsApp Worker │ │   │
│   │   └─────────────────┘   └─────────────┘   └──────────┬──────────┘ │   │
│   │                                                       │            │   │
│   │                                           ┌───────────┴──────────┐ │   │
│   │                                           │  Azure Blob Storage  │ │   │
│   │                                           │  (Session Persist)   │ │   │
│   │                                           └──────────────────────┘ │   │
│   └────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 2.2 Trust Boundaries (Security View)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TRUST BOUNDARY DIAGRAM                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    UNTRUSTED ZONE (Client)                           │   │
│   │   ┌─────────────┐   ┌─────────────┐   ┌─────────────────────────┐   │   │
│   │   │ Browser JS  │   │  DevTools   │   │  Direct Firebase SDK    │   │   │
│   │   │ Console     │   │  Network    │   │  Calls (Bypassable)     │   │   │
│   │   └──────┬──────┘   └──────┬──────┘   └────────────┬────────────┘   │   │
│   └──────────┼─────────────────┼───────────────────────┼────────────────┘   │
│              │                 │                       │                     │
│   ═══════════╪═════════════════╪═══════════════════════╪═════════════════   │
│              │     🔴 CRITICAL GAP: No server-side     │                     │
│              │        identity verification            │                     │
│   ═══════════╪═════════════════╪═══════════════════════╪═════════════════   │
│              ▼                 ▼                       ▼                     │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    TRUSTED ZONE (Server-Side)                        │   │
│   │   ┌─────────────────┐   ┌───────────────────────────────────────┐   │   │
│   │   │ Next.js API     │   │        Firebase Admin SDK             │   │   │
│   │   │ Routes          │   │        (Bypasses Rules)               │   │   │
│   │   │ ⚠️ No auth check │   │                                       │   │   │
│   │   └─────────────────┘   └───────────────────────────────────────┘   │   │
│   │                                                                      │   │
│   │   ┌─────────────────────────────────────────────────────────────┐   │   │
│   │   │                    Firestore                                 │   │   │
│   │   │   🔴 Rules allow owner to set ANY field including isAdmin   │   │   │
│   │   └─────────────────────────────────────────────────────────────┘   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 2.3 Data Flow

```
User Action → React Component → Firestore SDK → Cloud Firestore
                                      ↓
                              Real-time Listener
                                      ↓
                              UI Update (onSnapshot)
```

## 2.4 Request Flow for Key Operations

### 2.4.1 Prediction Submission Flow

```
┌─────────┐    ┌─────────────┐    ┌──────────────────────┐    ┌───────────┐
│  User   │───►│  React UI   │───►│ POST /api/submit-    │───►│ Firestore │
│ Selects │    │ Predictions │    │ prediction           │    │           │
│ Drivers │    │   Page      │    │ (Server-side)        │    │ users/    │
└─────────┘    └─────────────┘    │                      │    │ {uid}/    │
                                  │ 🔴 NO AUTH CHECK     │    │predictions│
                                  │ • Validates 6 drivers│    │           │
                                  │ • Checks race lockout│    │ prediction│
                                  │ ⚠️ NO TRANSACTION    │    │_submissions│
                                  │ • Writes to subcoll  │    │           │
                                  │ • Writes to flat coll│    │           │
                                  │ • Logs audit event   │    │           │
                                  └──────────────────────┘    └───────────┘
```

### 2.4.2 Score Calculation Flow

```
┌─────────┐    ┌─────────────┐    ┌───────────────┐    ┌───────────┐
│  Admin  │───►│  Results    │───►│ 🔴 CLIENT-SIDE│───►│ Firestore │
│ Enters  │    │  Manager    │    │ Calculation   │    │           │
│ Top 6   │    │   Tab       │    │               │    │ race_     │
└─────────┘    └─────────────┘    │ • Query all   │    │ results/  │
                                  │   predictions │    │           │
                                  │ • Apply Prix  │    │ scores/   │
                                  │   Six rules   │    │           │
                                  │ • Write scores│    │           │
                                  │ ⚠️ TAMPERABLE │    │           │
                                  └───────────────┘    └───────────┘
```

---

# 3. Technology Stack

## 3.1 Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 15.5.9 | React framework with App Router |
| React | 19.2.1 | UI component library |
| Tailwind CSS | 3.4.1 | Utility-first CSS framework |
| shadcn/ui | Latest | Radix-based component library |
| Lucide React | 0.475.0 | Icon library |
| Recharts | 2.15.1 | Charting library |
| React Hook Form | 7.54.2 | Form management |
| Zod | 3.24.2 | Schema validation |
| date-fns | 3.6.0 | Date utilities |

## 3.2 Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| Firebase | 11.9.1 | Client SDK |
| Firebase Admin | 13.4.0 | Server SDK for API routes |
| Firestore | - | NoSQL database |
| Firebase Auth | - | User authentication |
| Firebase Hosting | - | Static + SSR hosting |

## 3.3 External Services

| Service | Purpose | Authentication |
|---------|---------|----------------|
| Microsoft Graph | Email sending | OAuth2 Client Credentials |
| Google Gemini | AI content generation | API Key |
| Azure Blob Storage | WhatsApp session persistence | Connection String |
| Azure Container Instance | WhatsApp worker hosting | Managed Identity |

## 3.4 WhatsApp Worker

| Technology | Version | Purpose |
|------------|---------|---------|
| whatsapp-web.js | 1.26.x | WhatsApp Web automation |
| Puppeteer | Bundled | Headless Chrome |
| Express | 4.x | HTTP server for health checks |
| @azure/storage-blob | 12.x | Session persistence |

## 3.5 Development Tools

| Tool | Purpose |
|------|---------|
| TypeScript | 5.x | Type safety |
| ts-node | 10.9.2 | Script execution |
| Genkit CLI | 1.20.0 | AI development |

---

# 4. Authentication System

## 4.1 Overview

Prix Six uses a simplified PIN-based authentication system. Users authenticate with their email address and a 6-digit PIN rather than a traditional password. The PIN is stored as the user's Firebase Auth password.

### 4.1.1 Security Assessment

| Aspect | Current State | Risk Level |
|--------|--------------|------------|
| PIN Complexity | 6 digits (1M combinations) | ⚠️ WEAK |
| Brute Force Protection | Client-side lockout only | 🔴 BYPASSABLE |
| Account Lockout | Stored in user doc (editable) | 🔴 BYPASSABLE |
| Session Management | Firebase Auth JWT | ✅ OK |

**See [Section 24.2](#242-gap-2-pin-head-authentication-strategy) for detailed analysis.**

## 4.2 Authentication Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         AUTHENTICATION FLOW                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌───────────┐     ┌───────────────────────────────────────────────────┐   │
│   │           │     │                    LOGIN                           │   │
│   │   USER    │────►│  1. Enter email                                   │   │
│   │           │     │  2. Enter 6-digit PIN                             │   │
│   └───────────┘     │  3. Firebase signInWithEmailAndPassword()         │   │
│                     │  4. ⚠️ Check badLoginAttempts (CLIENT-SIDE)        │   │
│                     │  5. Check mustChangePin flag                       │   │
│                     │  6. Log audit event (success/fail)                │   │
│                     │  7. Redirect to dashboard or PIN change           │   │
│                     └───────────────────────────────────────────────────┘   │
│                                                                              │
│   ┌───────────┐     ┌───────────────────────────────────────────────────┐   │
│   │           │     │                    SIGNUP                          │   │
│   │ NEW USER  │────►│  1. Check newUserSignupEnabled config             │   │
│   │           │     │  2. Enter email (unique, case-insensitive)        │   │
│   └───────────┘     │  3. Enter team name (unique, case-insensitive)    │   │
│                     │  4. System generates random 6-digit PIN           │   │
│                     │  5. Firebase createUserWithEmailAndPassword()      │   │
│                     │  6. Create Firestore user document                 │   │
│                     │  7. Create Firestore presence document             │   │
│                     │  8. POST /api/send-welcome-email with PIN         │   │
│                     │  9. Log USER_REGISTERED audit event               │   │
│                     └───────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 4.3 Login Security Implementation

### 4.3.1 Current Implementation (provider.tsx lines 113-157)

```typescript
const login = async (email: string, pin: string): Promise<AuthResult> => {
  try {
    // Firebase Auth processes the request REGARDLESS of lockout state
    const userCredential = await signInWithEmailAndPassword(auth, email, pin);

    // Reset lockout counter on success
    if(userDocSnap.data()?.badLoginAttempts || 0 > 0) {
      await updateDoc(userDocRef, { badLoginAttempts: 0 });
    }

    return { success: true, message: 'Login successful' };

  } catch (signInError: any) {
    // ⚠️ LOCKOUT CHECK HAPPENS AFTER FIREBASE AUTH FAILS
    if (signInError.code === 'auth/invalid-credential') {
      if ((userDocData.badLoginAttempts || 0) >= 5) {
        // ⚠️ THIS IS CLIENT-SIDE ONLY - Firebase Auth still processed the attempt
        return { success: false, message: "This account is locked." };
      }
      // Increment counter in Firestore
      await updateDoc(userDocSnap.ref, { badLoginAttempts: increment(1) });
    }
  }
};
```

### 4.3.2 Known Gap: Lockout Bypass

**Attack Vector:**
```bash
# Attacker bypasses the React app entirely and calls Firebase Auth REST API
curl -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"victim@example.com","password":"123456","returnSecureToken":true}'
```

The lockout counter only prevents the React app from allowing login. The actual Firebase Auth endpoint processes unlimited attempts.

## 4.4 PIN Reset Flow

### 4.4.1 Current Implementation (provider.tsx lines 378-403)

```typescript
const resetPin = async (email: string): Promise<AuthResult> => {
  // Find user by email
  const querySnapshot = await getDocs(q);
  const userDocRef = querySnapshot.docs[0].ref;

  // Generate new PIN
  const newPin = Math.floor(100000 + Math.random() * 900000).toString();

  // 🔴 CRITICAL: This comment is in the actual code!
  // "This is not secure. A Cloud Function should be used to update the Auth user's password."
  // "This is a simulation for the demo."

  // Only sets flag - DOES NOT UPDATE FIREBASE AUTH PASSWORD
  await updateDoc(userDocRef, { mustChangePin: true });

  // Sends email with PIN that doesn't work
  const mailHtml = `Your temporary PIN is: <strong>${newPin}</strong>`;
  addDocumentNonBlocking(collection(firestore, 'mail'), {
    to: email, message: { subject: mailSubject, html: mailHtml }
  });

  return { success: true, message: "A temporary PIN has been sent." };
};
```

**🔴 CRITICAL GAP:** The reset PIN functionality is broken. It:
1. Generates a new PIN
2. Emails it to the user
3. Sets `mustChangePin: true`
4. **NEVER updates Firebase Auth** - the old PIN still works!

The user receives a PIN that doesn't work, and their old PIN remains valid.

## 4.5 User Document Structure

```typescript
// Collection: users/{userId}
// Document ID: Firebase Auth UID

interface UserDocument {
  // Identity
  id: string;                    // Firebase Auth UID
  email: string;                 // User email (unique)
  teamName: string;              // Primary display name (unique)
  secondaryTeamName?: string;    // Optional alternate name

  // Permissions
  isAdmin: boolean;              // 🔴 EDITABLE BY OWNER (see Section 24.1)

  // Security
  mustChangePin: boolean;        // Force PIN reset on login
  badLoginAttempts: number;      // 🔴 EDITABLE BY OWNER (see Section 24.2)

  // Preferences
  emailPreferences: {
    rankingChanges: boolean;
    raceReminders: boolean;
    newsFeed: boolean;
    resultsNotifications: boolean;
  };

  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

## 4.6 Protected Admin Accounts

```typescript
const PROTECTED_ADMIN_EMAILS = [
  'aaron@garcia.ltd',           // Primary admin
  'aaron.garcia@hotmail.co.uk'  // Secondary admin
];
```

**Note:** This protection is UI-level only. It prevents the admin panel from modifying these accounts, but does not prevent direct Firestore writes.

---

# 5. User-Facing Pages

## 5.1 Page Overview

| # | Route | Page Name | Purpose | Auth Required |
|---|-------|-----------|---------|---------------|
| 1 | `/login` | Login | User authentication | No |
| 2 | `/signup` | Sign Up | New user registration | No |
| 3 | `/forgot-pin` | Forgot PIN | PIN reset request (🔴 BROKEN) | No |
| 4 | `/dashboard` | Dashboard | Home page with hot news | Yes |
| 5 | `/predictions` | Predictions | Submit race predictions | Yes |
| 6 | `/standings` | Standings | League leaderboard | Yes |
| 7 | `/results` | Results | View race results & scores | Yes |
| 8 | `/teams` | Teams | View all league teams | Yes |
| 9 | `/submissions` | Submissions | View all predictions | Yes |
| 10 | `/schedule` | Schedule | 2026 F1 race calendar | Yes |
| 11 | `/rules` | Rules | Scoring rules explanation | Yes |
| 12 | `/profile` | Profile | User settings & preferences | Yes |
| 13 | `/about` | About | App info & system status | Yes |

## 5.2 Predictions Page (`/predictions`)

### 5.2.1 Purpose
Allows users to select their top 6 predicted finishers for the next race before the qualifying deadline.

### 5.2.2 Submission Security

**Current Implementation:**
```typescript
// React component calls API
const response = await fetch('/api/submit-prediction', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: user.id,      // 🔴 ATTACKER CAN CHANGE THIS
    teamId: user.id,
    teamName: user.teamName,
    raceId: normalizedRaceId,
    raceName: nextRace.name,
    predictions: selectedDrivers,
  }),
});
```

**🔴 CRITICAL GAP:** The API trusts the `userId` from the request body. An attacker can submit predictions for any user.

### 5.2.3 Driver Data (2026 Season - 22 Drivers)

```typescript
// Location: src/lib/data.ts

export const F1Drivers: Driver[] = [
  // Red Bull Racing
  { id: 'verstappen', name: 'Verstappen', number: 3, team: 'Red Bull Racing' },
  { id: 'hadjar', name: 'Hadjar', number: 6, team: 'Red Bull Racing' },
  // Ferrari
  { id: 'leclerc', name: 'Leclerc', number: 16, team: 'Ferrari' },
  { id: 'hamilton', name: 'Hamilton', number: 44, team: 'Ferrari' },
  // McLaren
  { id: 'norris', name: 'Norris', number: 1, team: 'McLaren' },
  { id: 'piastri', name: 'Piastri', number: 81, team: 'McLaren' },
  // Mercedes
  { id: 'russell', name: 'Russell', number: 63, team: 'Mercedes' },
  { id: 'antonelli', name: 'Antonelli', number: 12, team: 'Mercedes' },
  // Aston Martin
  { id: 'alonso', name: 'Alonso', number: 14, team: 'Aston Martin' },
  { id: 'stroll', name: 'Stroll', number: 18, team: 'Aston Martin' },
  // Alpine
  { id: 'gasly', name: 'Gasly', number: 10, team: 'Alpine' },
  { id: 'colapinto', name: 'Colapinto', number: 43, team: 'Alpine' },
  // Williams
  { id: 'albon', name: 'Albon', number: 23, team: 'Williams' },
  { id: 'sainz', name: 'Sainz', number: 55, team: 'Williams' },
  // Racing Bulls
  { id: 'lawson', name: 'Lawson', number: 30, team: 'Racing Bulls' },
  { id: 'lindblad', name: 'Lindblad', number: 41, team: 'Racing Bulls' },
  // Audi (formerly Sauber)
  { id: 'hulkenberg', name: 'Hulkenberg', number: 27, team: 'Audi' },
  { id: 'bortoleto', name: 'Bortoleto', number: 5, team: 'Audi' },
  // Haas F1 Team
  { id: 'ocon', name: 'Ocon', number: 31, team: 'Haas F1 Team' },
  { id: 'bearman', name: 'Bearman', number: 87, team: 'Haas F1 Team' },
  // Cadillac F1 Team (11th team for 2026)
  { id: 'perez', name: 'Perez', number: 11, team: 'Cadillac F1 Team' },
  { id: 'bottas', name: 'Bottas', number: 77, team: 'Cadillac F1 Team' },
];
```

---

# 6. Admin Dashboard

## 6.1 Overview

The Admin Dashboard is a comprehensive 10-tab interface for managing all aspects of the Prix Six application. Access is restricted to users with `isAdmin: true` in their user document.

### 6.1.1 Access Control

```typescript
// Admin check in AuthGuard - CLIENT-SIDE ONLY
if (pathname.startsWith('/admin') && !userData?.isAdmin) {
  router.push('/dashboard');
  return;
}
```

**⚠️ Note:** This check is client-side only. A user who has exploited the privilege escalation vulnerability (Section 24.1) would pass this check.

### 6.1.2 Tab Overview

| Tab # | Tab Name | Purpose | Security Notes |
|-------|----------|---------|----------------|
| 1 | Site Functions | Global site controls | Admin SDK writes |
| 2 | Team Manager | User management | Admin SDK writes |
| 3 | Results Manager | Race results entry | 🔴 Client-side scoring |
| 4 | Scoring Manager | Score management | 🔴 Client-side calculation |
| 5 | Hot News Manager | AI news content | Admin SDK writes |
| 6 | Online Users | User presence | Session purge capability |
| 7 | Email Log | Email history | Read-only |
| 8 | Audit Manager | Audit trail | Read-only |
| 9 | WhatsApp Manager | WhatsApp alerts | Admin SDK writes |
| 10 | Consistency Checker | Data validation | Read-only |

## 6.2 Tab 3: Results Manager

### 6.2.1 Score Calculation - Security Issue

**🔴 CRITICAL GAP:** Score calculation happens **client-side** in the admin panel:

```typescript
// This runs in the admin's browser - NOT on a server
async function calculateAndSaveScores(raceResult: RaceResult) {
  // 1. Query all predictions
  const predictions = await getDocs(collectionGroup(firestore, 'predictions'));

  // 2. Calculate scores (in browser JavaScript)
  const scores = predictions.docs.map(doc => {
    const predicted = doc.data().predictions;
    let points = 0;
    // ... scoring logic that could be modified
    return { userId: doc.data().userId, points };
  });

  // 3. Write to Firestore - accepts whatever the browser sends
  for (const score of scores) {
    await setDoc(doc(firestore, 'scores', `${raceId}_${score.userId}`), score);
  }
}
```

**Attack Scenario:**
1. Attacker compromises admin's laptop (XSS, malicious extension, physical access)
2. Attacker modifies the scoring algorithm in browser DevTools
3. Attacker gives themselves 500 points per race
4. Firestore accepts the write because admin has permission

---

# 7. Database Architecture

## 7.1 Firestore Collections Overview

```
firestore/
├── users/                          # User accounts
│   └── {userId}/
│       └── predictions/            # User's race predictions (subcollection)
├── prediction_submissions/         # Flat mirror of predictions
├── race_results/                   # Official race results
├── scores/                         # Calculated scores per user per race
├── app-settings/                   # Application settings
│   └── hot-news
├── admin_configuration/            # Admin settings
│   ├── global                      # Signup enabled, Single User Mode
│   └── whatsapp_alerts             # WhatsApp alert configuration
├── whatsapp_queue/                 # Pending WhatsApp messages
├── whatsapp_alert_history/         # Sent WhatsApp alerts audit
├── email_queue/                    # Pending emails (rate limited)
├── email_logs/                     # Sent email log
├── email_daily_stats/              # Daily email statistics
├── mail/                           # Firebase Email Extension trigger
├── presence/                       # User online status with sessions
├── audit_logs/                     # User action audit trail
├── error_logs/                     # Application error tracking
└── coordination/                   # Claude Code session coordination
    └── claude-state
```

## 7.2 Dual Prediction Storage - Race Condition Risk

**⚠️ KNOWN GAP:** Predictions are stored in TWO places with NO transaction:

```typescript
// Location: /api/submit-prediction/route.ts lines 55-95

// Write 1: User's predictions subcollection
await predictionRef.set({ ... }, { merge: true });

// ⚠️ NO TRANSACTION - What if this fails?
// Write 2: Flat prediction_submissions collection
await db.collection('prediction_submissions').add({ ... });

// ⚠️ NO TRANSACTION - What if this fails?
// Write 3: Audit log
await db.collection('audit_logs').add({ ... });
```

**Failure Scenario:**
1. Write 1 succeeds → User sees "Prediction Saved"
2. Write 2 fails (network timeout) → Admin doesn't see prediction
3. Write 3 fails → No audit trail

**Result:** Data inconsistency between user view and admin view.

---

# 8. Scoring System

## 8.1 Prix Six Scoring Rules

| Scenario | Points | Description |
|----------|--------|-------------|
| **Exact Position** | +5 | Driver finishes in exact predicted position |
| **Wrong Position** | +3 | Driver in top 6 but different position |
| **Not in Top 6** | +0 | Driver outside top 6 |
| **All 6 Bonus** | +10 | All 6 predicted drivers in top 6 |

**Maximum per race: 40 points** = (6 × 5) + 10

## 8.2 Scoring Implementation

**🔴 KNOWN GAP:** Scoring is calculated client-side in the admin's browser. See [Section 24.3](#243-gap-3-client-side-god-mode-scoring) for full analysis.

## 8.3 Race ID Normalisation

```typescript
// Location: src/lib/scoring.ts, src/lib/consistency.ts

export function normalizeRaceId(raceName: string): string {
  return raceName
    .replace(/\s*-\s*GP$/i, '')      // Remove " - GP" suffix
    .replace(/\s*-\s*Sprint$/i, '')  // Remove " - Sprint" suffix
    .replace(/\s+/g, '-');            // Replace spaces with dashes
}
```

---

# 9-13. [Sections unchanged from V3 - Email, WhatsApp, Consistency Checker, Audit System, Session Management]

*For brevity, sections 9-13 retain their V3 content. See V3 document for full details.*

---

# 14. Session Management System

## 14.1 Security Assessment

| Feature | Purpose | Security Value |
|---------|---------|----------------|
| Session GUID | Track browser tabs | 🟡 COSMETIC ONLY |
| Presence array | Show online users | 🟡 DISPLAY ONLY |
| Single User Mode | Admin isolation | ⚠️ BYPASSABLE |

### 14.1.1 Session GUID Analysis

**Current Implementation:**
```typescript
// Session ID is generated on mount and stored in context
const [sessionId, setSessionId] = useState<string | null>(null);
useEffect(() => {
  setSessionId(generateGuid());
}, []);
```

**🟡 KNOWN GAP:** The session GUID provides **no security value**:
- It's not validated server-side
- It's not tied to the Firebase Auth token
- Copying it to another browser does nothing harmful (Firebase Auth handles real session security)
- It's purely cosmetic for the "Online Users" admin panel

This is **not a vulnerability** - it's just not a security feature as might be implied.

---

# 15-19. [Sections unchanged from V3 - Error Handling, React Patterns, AI/Genkit, Claude Coordination, ID Conventions]

*For brevity, sections 15-19 retain their V3 content. See V3 document for full details.*

---

# 20. Security Architecture

## 20.1 Firestore Security Rules (Current - VULNERABLE)

```javascript
// Location: app/src/firestore.rules
// 🔴 THIS FILE CONTAINS CRITICAL VULNERABILITIES

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }

    function isOwner(userId) {
      return isSignedIn() && request.auth.uid == userId;
    }

    function isAdmin() {
      return isSignedIn() &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.isAdmin == true;
    }

    match /users/{userId} {
      allow get: if isOwner(userId) || isAdmin();
      allow list: if isSignedIn();
      allow create: if isOwner(userId);

      // 🔴 CRITICAL: No field validation - owner can set isAdmin: true
      allow update: if isOwner(userId) || isAdmin();

      allow delete: if isOwner(userId);

      match /predictions/{predictionId} {
        allow read: if isSignedIn();
        allow write: if isOwner(userId) || isAdmin();
      }
    }

    // ... rest of rules
  }
}
```

## 20.2 What SHOULD Be the Security Rules

```javascript
// RECOMMENDED FIX - Not currently implemented

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }

    function isOwner(userId) {
      return isSignedIn() && request.auth.uid == userId;
    }

    function isAdmin() {
      return isSignedIn() &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.isAdmin == true;
    }

    // Helper: Check which fields are being modified
    function onlyChangingAllowedFields() {
      let allowedFields = ['teamName', 'secondaryTeamName', 'emailPreferences'];
      let changedFields = request.resource.data.diff(resource.data).affectedKeys();
      return changedFields.hasOnly(allowedFields);
    }

    match /users/{userId} {
      allow get: if isOwner(userId) || isAdmin();
      allow list: if isSignedIn();
      allow create: if isOwner(userId) &&
        request.resource.data.isAdmin == false &&
        request.resource.data.badLoginAttempts == 0;

      // FIXED: Owner can only change allowed fields
      // Admin can change any field
      allow update: if (isOwner(userId) && onlyChangingAllowedFields()) || isAdmin();

      allow delete: if isAdmin(); // Only admin can delete users

      match /predictions/{predictionId} {
        allow read: if isSignedIn();
        allow write: if isOwner(userId) || isAdmin();
      }
    }
  }
}
```

## 20.3 Rate Limiting Summary

| Limit | Value | Purpose | Enforced By |
|-------|-------|---------|-------------|
| Email Global | 30/day | Prevent spam | Server-side |
| Email Per-Address | 5/day | Prevent harassment | Server-side |
| WhatsApp | 5-10 sec between | Avoid bans | Worker service |
| Failed Logins | 5 attempts | Brute force protection | 🔴 Client-side only |

---

# 21. Deployment Architecture

## 21.1 Firebase Deployment

```
Firebase Project: studio-6033436327-281b1
Region: europe-west4
URL: https://prixsix--studio-6033436327-281b1.europe-west4.hosted.app
```

## 21.2 Azure WhatsApp Worker

```
Resource Group: PrixSix
Container Registry: prixsixacr.azurecr.io
Container Instance: prixsix-whatsapp-worker
Storage Account: prixsixstorage
Blob Container: whatsapp-session
```

### 21.2.1 WhatsApp Session Storage Security

**⚠️ REQUIRES VERIFICATION:**
- Is the blob container access level set to "Private"?
- Are encryption keys properly managed?
- If the blob is accessible, an attacker could:
  1. Download the WhatsApp session data
  2. Import it into their own whatsapp-web.js instance
  3. Send messages as the bot (spam, impersonation)
  4. Get the linked phone number banned

**Recommended Check:**
```bash
az storage container show --name whatsapp-session --account-name prixsixstorage --query "properties.publicAccess"
# Expected: "null" or "none"
```

---

# 22. API Reference

## 22.1 Prediction API

### POST /api/submit-prediction

**🔴 CRITICAL VULNERABILITY:** No caller identity verification.

**Current Implementation:**
```typescript
export async function POST(request: NextRequest) {
  const data: PredictionRequest = await request.json();
  const { userId, teamId, teamName, raceId, raceName, predictions } = data;

  // 🔴 BUG: Trusts userId from body without verification
  // Should be: const userId = await verifyFirebaseToken(request);

  // Validates predictions array - OK
  if (!Array.isArray(predictions) || predictions.length !== 6) {
    return NextResponse.json({ error: 'Invalid predictions' }, { status: 400 });
  }

  // Checks race lockout - OK
  if (Date.now() > qualifyingTime) {
    return NextResponse.json({ error: 'Pit lane closed' }, { status: 403 });
  }

  // Writes to Firestore using Admin SDK (bypasses rules)
  await predictionRef.set({ userId, ... }); // 🔴 userId is attacker-controlled
}
```

**Attack:**
```bash
# Submit prediction as any user
curl -X POST "https://prixsix.../api/submit-prediction" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "VICTIM_USER_ID",
    "teamId": "VICTIM_USER_ID",
    "teamName": "Victim Team",
    "raceId": "Australian-Grand-Prix",
    "raceName": "Australian Grand Prix",
    "predictions": ["verstappen", "hamilton", "norris", "leclerc", "piastri", "russell"]
  }'
```

**Required Fix:**
```typescript
import { getAuth } from 'firebase-admin/auth';

export async function POST(request: NextRequest) {
  // Verify the Firebase ID token from the Authorization header
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const idToken = authHeader.split('Bearer ')[1];
  const decodedToken = await getAuth().verifyIdToken(idToken);
  const userId = decodedToken.uid; // Use verified UID, not body

  // ... rest of logic
}
```

---

# 23. Environment Configuration

## 23.1 Next.js App (.env)

```bash
# Firebase (Public)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=

# Firebase Admin (Server-side)
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

# Microsoft Graph (Email)
AZURE_TENANT_ID=
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
FROM_EMAIL=

# Google AI (Genkit)
GOOGLE_GENAI_API_KEY=
```

## 23.2 WhatsApp Worker (.env)

```bash
# Firestore Access
GOOGLE_APPLICATION_CREDENTIALS=/app/service-account.json

# Azure Blob Storage
AZURE_STORAGE_CONNECTION_STRING=
AZURE_STORAGE_CONTAINER=whatsapp-session

# Server
PORT=3000
```

## 23.3 Secret Injection Strategy

**⚠️ KNOWN GAP:** The documentation does not specify how secrets are injected into the Azure Container Instance.

**Current State (Requires Verification):**
- Are secrets in Azure Container Instance environment variables?
- Is Azure Key Vault used?
- How is the service-account.json mounted?

**Recommended Architecture:**
```
Azure Key Vault
    │
    ├──► Managed Identity ──► ACI reads secrets at runtime
    │
    └──► No secrets in container image or environment variables
```

---

# 24. SECURITY AUDIT: Known Gaps & Remediations

This section documents all identified security vulnerabilities, their severity, exploitation methods, and recommended fixes.

## 24.0 Executive Summary

| # | Vulnerability | Severity | Exploitability | Status |
|---|--------------|----------|----------------|--------|
| 1 | Privilege Escalation via Firestore | 🔴 CRITICAL | Trivial | **UNPATCHED** |
| 2 | Client-Side Only Login Lockout | 🔴 HIGH | Easy | **UNPATCHED** |
| 3 | Client-Side Scoring (Admin Compromise) | 🔴 HIGH | Requires Admin Access | **UNPATCHED** |
| 4 | API Route User Impersonation | 🔴 CRITICAL | Trivial | **UNPATCHED** |
| 5 | Prediction Dual-Write Race Condition | 🟡 MEDIUM | Rare | **UNPATCHED** |
| 6 | PIN Reset Function is Broken | 🔴 CRITICAL | N/A (Feature Broken) | **UNPATCHED** |
| 7 | Session GUID is Cosmetic | 🟢 LOW | N/A | **BY DESIGN** |

---

## 24.1 GAP 1: Self-Promotion Privilege Escalation

### Classification
- **Severity:** 🔴 CRITICAL
- **CVSS Score:** 9.8 (Critical)
- **Attack Complexity:** Low
- **Privileges Required:** Low (Any authenticated user)
- **User Interaction:** None

### Vulnerability Description

The Firestore security rules allow any authenticated user to update their own user document without field-level validation. This includes the `isAdmin` field.

### Affected Code

**File:** `app/src/firestore.rules` (Line 23)
```javascript
match /users/{userId} {
  // ...
  allow update: if isOwner(userId) || isAdmin();  // 🔴 NO FIELD VALIDATION
}
```

### Proof of Concept

```javascript
// Execute in browser console while logged in as any user
import { doc, updateDoc } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';

const db = getFirestore();
const myUserId = 'abc123xyz789'; // Attacker's own user ID

await updateDoc(doc(db, 'users', myUserId), {
  isAdmin: true
});

console.log('You are now an admin. Refresh the page.');
```

### Impact

1. **Admin Access:** Attacker gains full admin privileges
2. **Data Destruction:** Can delete all users, scores, predictions
3. **Data Manipulation:** Can modify any user's data
4. **Score Fraud:** Can give themselves unlimited points
5. **System Takeover:** Full control of the application

### Recommended Remediation

**Option A: Field-Level Validation in Security Rules**
```javascript
match /users/{userId} {
  function onlyChangingAllowedFields() {
    let protectedFields = ['isAdmin', 'badLoginAttempts', 'mustChangePin'];
    let changedFields = request.resource.data.diff(resource.data).affectedKeys();
    return !changedFields.hasAny(protectedFields);
  }

  allow update: if (isOwner(userId) && onlyChangingAllowedFields()) || isAdmin();
}
```

**Option B: Move All Writes to Server-Side API**
- Remove client-side write access entirely
- All updates go through authenticated API routes
- API routes verify permissions before writing

### Remediation Priority
**IMMEDIATE** - This vulnerability allows complete system takeover.

---

## 24.2 GAP 2: PIN-Head Authentication Strategy

### Classification
- **Severity:** 🔴 HIGH
- **CVSS Score:** 7.5 (High)
- **Attack Complexity:** Low
- **Privileges Required:** None
- **User Interaction:** None

### Vulnerability Description

The authentication system uses a 6-digit PIN (1,000,000 combinations) with client-side only lockout enforcement. The lockout counter is stored in a Firestore document that the user could potentially modify.

### Affected Code

**File:** `app/src/firebase/provider.tsx` (Lines 113-157)
```typescript
const login = async (email: string, pin: string) => {
  try {
    // Firebase Auth processes the request FIRST
    const userCredential = await signInWithEmailAndPassword(auth, email, pin);
    // ... success handling
  } catch (signInError) {
    // Lockout check happens AFTER Firebase Auth fails
    if ((userDocData.badLoginAttempts || 0) >= 5) {
      return { success: false, message: "Account locked" };
    }
    // Increment counter
    await updateDoc(userDocSnap.ref, { badLoginAttempts: increment(1) });
  }
};
```

### Attack Vectors

**Vector 1: Direct Firebase Auth API**
```bash
# Bypass the React app entirely
for PIN in $(seq -w 000000 999999); do
  curl -s -X POST \
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"victim@example.com\",\"password\":\"$PIN\",\"returnSecureToken\":true}" \
    | grep -q "idToken" && echo "PIN found: $PIN" && break
done
```

**Vector 2: Reset Lockout Counter**
```javascript
// If privilege escalation is exploited first, reset your own counter
await updateDoc(doc(db, 'users', myUserId), { badLoginAttempts: 0 });
```

### Impact

1. **Account Compromise:** Brute force any user's PIN
2. **Account Lockout Bypass:** Reset lockout counter if isAdmin is set
3. **Mass Account Access:** Automate PIN cracking for all users

### Recommended Remediation

**Option A: Firebase Identity Platform Blocking Functions**
```typescript
// Cloud Function that runs BEFORE Firebase Auth processes login
exports.beforeSignIn = functions.auth.user().beforeSignIn((user, context) => {
  const userDoc = await admin.firestore().collection('users').doc(user.uid).get();

  if (userDoc.data()?.badLoginAttempts >= 5) {
    throw new functions.auth.HttpsError(
      'failed-precondition',
      'Account is locked. Contact support.'
    );
  }
});
```

**Option B: Stronger Authentication**
- Use passwords instead of 6-digit PINs
- Implement MFA (TOTP/SMS)
- Use Firebase Auth's built-in email link authentication

**Option C: Server-Side Rate Limiting**
- Add CAPTCHA after 3 failed attempts
- Implement IP-based rate limiting
- Add exponential backoff

### Remediation Priority
**HIGH** - Addresses brute-force risk, but depends on threat model.

---

## 24.3 GAP 3: Client-Side God Mode Scoring

### Classification
- **Severity:** 🔴 HIGH
- **CVSS Score:** 7.2 (High)
- **Attack Complexity:** High (Requires Admin compromise)
- **Privileges Required:** High (Admin account)
- **User Interaction:** None

### Vulnerability Description

Score calculation occurs in the Admin's browser, not on a trusted server. The Firestore rules allow Admins to write any value to the `scores` collection without validation.

### Affected Code

**File:** Admin Results Manager Component
```typescript
// This runs in the admin's browser
async function calculateAndSaveScores(raceResult: RaceResult) {
  const predictions = await getDocs(collectionGroup(firestore, 'predictions'));

  const scores = predictions.docs.map(doc => {
    // 🔴 Calculation happens client-side - can be modified
    let points = 0;
    // ... scoring logic
    return { userId, points };
  });

  // 🔴 Writes whatever the browser calculated
  for (const score of scores) {
    await setDoc(doc(firestore, 'scores', scoreId), score);
  }
}
```

**File:** `app/src/firestore.rules` (Lines 43-46)
```javascript
match /scores/{scoreId} {
  allow get, list: if true;
  allow write: if isAdmin();  // 🔴 No validation of score values
}
```

### Attack Vectors

**Vector 1: Browser DevTools Modification**
1. Open Admin panel in browser
2. Open DevTools → Sources
3. Set breakpoint in scoring function
4. Modify `points` variable before write

**Vector 2: Malicious Browser Extension**
1. Attacker installs extension with `*` permissions
2. Extension intercepts Firestore writes
3. Modifies score values before they hit the network

**Vector 3: XSS Attack**
1. If any XSS exists in the app
2. Injected script waits for admin to calculate scores
3. Modifies DOM/JS to alter scores

### Impact

1. **Score Fraud:** Give any team unlimited points
2. **League Manipulation:** Determine winners/losers
3. **Historical Revision:** Modify past race scores
4. **Trust Destruction:** Players lose faith in system

### Recommended Remediation

**Option A: Server-Side Score Calculation (Recommended)**

```typescript
// New API route: /api/calculate-scores

export async function POST(request: NextRequest) {
  // 1. Verify admin token
  const decodedToken = await getAuth().verifyIdToken(token);
  const adminDoc = await db.collection('users').doc(decodedToken.uid).get();
  if (!adminDoc.data()?.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 2. Receive only race results
  const { raceId, driver1, driver2, driver3, driver4, driver5, driver6 } = await request.json();

  // 3. Fetch predictions server-side
  const predictions = await db.collectionGroup('predictions')
    .where('raceId', '==', raceId)
    .get();

  // 4. Calculate scores on server (trusted environment)
  const scores = predictions.docs.map(doc => {
    const predicted = doc.data().predictions;
    const actual = [driver1, driver2, driver3, driver4, driver5, driver6];
    return calculateScore(predicted, actual); // Server-side only
  });

  // 5. Write scores atomically
  const batch = db.batch();
  scores.forEach(score => {
    batch.set(db.collection('scores').doc(`${raceId}_${score.userId}`), score);
  });
  await batch.commit();

  return NextResponse.json({ success: true, scoresCalculated: scores.length });
}
```

**Option B: Score Validation in Firestore Rules**
```javascript
match /scores/{scoreId} {
  allow write: if isAdmin() &&
    request.resource.data.totalPoints >= 0 &&
    request.resource.data.totalPoints <= 40;  // Max possible score
}
```

### Remediation Priority
**HIGH** - Data integrity is core to the application's purpose.

---

## 24.4 GAP 4: API Route User Impersonation

### Classification
- **Severity:** 🔴 CRITICAL
- **CVSS Score:** 9.1 (Critical)
- **Attack Complexity:** Low
- **Privileges Required:** Low (Any authenticated user)
- **User Interaction:** None

### Vulnerability Description

The `/api/submit-prediction` route trusts the `userId` parameter from the request body without verifying it matches the authenticated caller.

### Affected Code

**File:** `app/src/app/api/submit-prediction/route.ts` (Lines 17-20)
```typescript
export async function POST(request: NextRequest) {
  const data: PredictionRequest = await request.json();
  const { userId, teamId, teamName, raceId, raceName, predictions } = data;

  // 🔴 BUG: userId comes from request body, not verified against auth token
  // The Admin SDK bypasses Firestore rules, so this writes for ANY userId

  await predictionRef.set({
    userId,  // Attacker-controlled
    // ...
  });
}
```

### Proof of Concept

```javascript
// Attacker submits prediction as another user
const victimUserId = 'REAL_VICTIM_USER_ID'; // Obtained from /teams page or network traffic

fetch('/api/submit-prediction', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: victimUserId,
    teamId: victimUserId,
    teamName: 'Victim Team Name',
    raceId: 'Australian-Grand-Prix',
    raceName: 'Australian Grand Prix',
    predictions: ['bottas', 'perez', 'stroll', 'hulkenberg', 'ocon', 'bearman'] // Garbage prediction
  })
});
```

### Impact

1. **Prediction Sabotage:** Submit bad predictions for rivals
2. **Score Manipulation:** Ensure competitors get 0 points
3. **Audit Trail Poisoning:** Victim appears to have submitted the prediction
4. **Deadline Exploitation:** Submit for others after they've already submitted (overwrites)

### Recommended Remediation

```typescript
// File: app/src/app/api/submit-prediction/route.ts

import { getAuth } from 'firebase-admin/auth';

export async function POST(request: NextRequest) {
  // 1. Extract and verify Firebase ID token
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing authorization header' }, { status: 401 });
  }

  const idToken = authHeader.split('Bearer ')[1];

  let decodedToken;
  try {
    decodedToken = await getAuth().verifyIdToken(idToken);
  } catch (error) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  }

  // 2. Use the verified UID, not the body
  const verifiedUserId = decodedToken.uid;

  // 3. Get user document for team name
  const userDoc = await db.collection('users').doc(verifiedUserId).get();
  if (!userDoc.exists) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const userData = userDoc.data();

  // 4. Only trust prediction data from body
  const { raceId, raceName, predictions } = await request.json();

  // 5. Write with verified identity
  await predictionRef.set({
    userId: verifiedUserId,
    teamId: verifiedUserId,
    teamName: userData.teamName,
    // ...
  });
}
```

**Client-Side Change Required:**
```typescript
// Get the current user's ID token
const idToken = await auth.currentUser?.getIdToken();

const response = await fetch('/api/submit-prediction', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${idToken}`,  // Add this
  },
  body: JSON.stringify({
    // userId no longer needed - server gets it from token
    raceId,
    raceName,
    predictions,
  }),
});
```

### Remediation Priority
**IMMEDIATE** - Any authenticated user can sabotage any other user.

---

## 24.5 GAP 5: Prediction Dual-Write Race Condition

### Classification
- **Severity:** 🟡 MEDIUM
- **CVSS Score:** 4.3 (Medium)
- **Attack Complexity:** High (Depends on timing)
- **Privileges Required:** None (Affects normal operation)
- **User Interaction:** None

### Vulnerability Description

The prediction submission writes to three locations without using a Firestore transaction or batch write.

### Affected Code

**File:** `app/src/app/api/submit-prediction/route.ts` (Lines 55-95)
```typescript
// Write 1
await predictionRef.set({ ... }, { merge: true });

// ⚠️ If network fails here, Write 1 succeeded but Write 2 didn't

// Write 2
await db.collection('prediction_submissions').add({ ... });

// ⚠️ If network fails here, Writes 1-2 succeeded but Write 3 didn't

// Write 3
await db.collection('audit_logs').add({ ... });
```

### Impact

1. **Data Inconsistency:** User sees "Submitted" but admin doesn't see it
2. **Missing Audit Trail:** Actions occur without logging
3. **Support Confusion:** Hard to debug "I submitted but it's not there"

### Recommended Remediation

```typescript
// Use a batched write for atomicity
const batch = db.batch();

const predictionRef = db.collection('users').doc(userId).collection('predictions').doc(predictionId);
batch.set(predictionRef, {
  id: predictionId,
  userId,
  predictions,
  submissionTimestamp: FieldValue.serverTimestamp(),
}, { merge: true });

const submissionRef = db.collection('prediction_submissions').doc();
batch.set(submissionRef, {
  userId,
  teamName,
  predictions: { P1: predictions[0], /* ... */ },
  submittedAt: FieldValue.serverTimestamp(),
});

const auditRef = db.collection('audit_logs').doc();
batch.set(auditRef, {
  userId,
  action: 'prediction_submitted',
  timestamp: FieldValue.serverTimestamp(),
});

// All three writes succeed or all three fail
await batch.commit();
```

### Remediation Priority
**MEDIUM** - Uncommon scenario but causes confusion when it occurs.

---

## 24.6 GAP 6: PIN Reset Function is Broken

### Classification
- **Severity:** 🔴 CRITICAL (Functionality Broken)
- **CVSS Score:** N/A (Not a vulnerability, but broken security feature)
- **Impact:** Users cannot recover accounts

### Vulnerability Description

The PIN reset function generates a new PIN and emails it to the user, but **never updates Firebase Auth**. The old PIN continues to work.

### Affected Code

**File:** `app/src/firebase/provider.tsx` (Lines 378-403)
```typescript
const resetPin = async (email: string): Promise<AuthResult> => {
  const newPin = Math.floor(100000 + Math.random() * 900000).toString();

  // 🔴 DEVELOPER COMMENT IN ACTUAL CODE:
  // "This is not secure. A Cloud Function should be used to update the Auth user's password."
  // "This is a simulation for the demo."

  await updateDoc(userDocRef, { mustChangePin: true }); // Only sets a flag

  // Sends email with PIN that DOESN'T WORK
  addDocumentNonBlocking(collection(firestore, 'mail'), {
    to: email,
    message: {
      subject: "Your Prix Six PIN has been reset",
      html: `Your temporary PIN is: <strong>${newPin}</strong>` // 🔴 This PIN is useless
    }
  });

  return { success: true, message: "A temporary PIN has been sent." };
  // 🔴 LIE: The "temporary PIN" doesn't work
};
```

### Impact

1. **User Lockout:** Users who forget their PIN cannot recover
2. **False Confidence:** Users think they can reset, but they can't
3. **Support Burden:** Admins must manually reset PINs

### Recommended Remediation

**Option A: Cloud Function to Reset Password**
```typescript
// Cloud Function
exports.resetUserPin = functions.https.onCall(async (data, context) => {
  // Verify request is from admin or the user themselves
  const { email } = data;

  // Generate new PIN
  const newPin = Math.floor(100000 + Math.random() * 900000).toString();

  // Find user by email
  const userRecord = await admin.auth().getUserByEmail(email);

  // Update Firebase Auth password
  await admin.auth().updateUser(userRecord.uid, {
    password: newPin,
  });

  // Set mustChangePin flag
  await admin.firestore().collection('users').doc(userRecord.uid).update({
    mustChangePin: true,
  });

  // Send email
  await sendEmail(email, 'PIN Reset', `Your new PIN is: ${newPin}`);

  return { success: true };
});
```

**Option B: Firebase Auth Email Password Reset**
- Use `sendPasswordResetEmail()` instead of custom flow
- Requires changing from PIN to password terminology

### Remediation Priority
**HIGH** - Core functionality is broken.

---

## 24.7 GAP 7: Session GUID is Cosmetic

### Classification
- **Severity:** 🟢 LOW / INFORMATIONAL
- **Status:** BY DESIGN

### Description

The session GUID generated on component mount is used only for the "Online Users" admin panel display. It provides no actual security benefit.

### Current Behavior

- Session GUID is generated client-side
- Stored in React context
- Added to `presence/{userId}.sessions` array
- Displayed in admin panel

### Security Value

**None.** The session GUID is cosmetic. Firebase Auth JWTs provide the actual session security.

### Recommendation

Document this as display-only feature, not a security control. No code change required, but consider renaming to `displaySessionId` or similar to avoid confusion.

---

# Appendix G: Security Remediation Checklist

## Immediate Priority (Week 1)

- [ ] **GAP 1:** Deploy updated Firestore security rules with field-level validation
- [ ] **GAP 4:** Add Firebase ID token verification to `/api/submit-prediction`

## High Priority (Week 2-3)

- [ ] **GAP 3:** Move score calculation to server-side API route
- [ ] **GAP 6:** Implement Cloud Function for PIN reset
- [ ] **GAP 5:** Convert prediction writes to atomic batch

## Medium Priority (Month 1)

- [ ] **GAP 2:** Implement Firebase Identity Platform blocking function for login lockout
- [ ] Verify Azure Blob Storage container is private
- [ ] Document secret injection strategy for Azure Container Instance

## Ongoing

- [ ] Security review for all new API routes
- [ ] Regular penetration testing
- [ ] Dependency vulnerability scanning

---

# Appendix A-F: [Unchanged from V3]

*For brevity, appendices A-F retain their V3 content. See V3 document for full details.*

---

**End of Document**

*Prix Six - Comprehensive High-Level Design Document*
*Version 4.0 (Security Audit Edition) - 21 January 2026*
*Total Sections: 24 + 7 Appendices*
*Security Gaps Documented: 7 (4 Critical, 2 High, 1 Medium)*

**⚠️ THIS APPLICATION REQUIRES IMMEDIATE SECURITY REMEDIATION BEFORE PRODUCTION USE**
