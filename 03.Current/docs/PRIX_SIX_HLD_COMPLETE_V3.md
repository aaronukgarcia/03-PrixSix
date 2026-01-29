# Prix Six - Comprehensive High-Level Design Document

**Version:** 1.10.0
**Last Updated:** 21 January 2026
**Document Version:** 3.0 (Enhanced Technical Reference)
**Authors:** Claude Code (AI-assisted documentation)

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
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
- [Appendix A: File Structure](#appendix-a-file-structure)
- [Appendix B: Version History](#appendix-b-version-history)
- [Appendix C: UI Components](#appendix-c-ui-components)
- [Appendix D: Utility Scripts](#appendix-d-utility-scripts)
- [Appendix E: Architectural Patterns](#appendix-e-architectural-patterns)
- [Appendix F: Type Definitions](#appendix-f-type-definitions)

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

## 1.3 Target Users

- **Players:** ~20 members of a WhatsApp group
- **Admins:** Will and Aaron (developers/administrators)

## 1.4 Technical Summary

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

## 2.2 Data Flow

```
User Action → React Component → Firestore SDK → Cloud Firestore
                                      ↓
                              Real-time Listener
                                      ↓
                              UI Update (onSnapshot)
```

## 2.3 Request Flow for Key Operations

### 2.3.1 Prediction Submission Flow

```
┌─────────┐    ┌─────────────┐    ┌──────────────────────┐    ┌───────────┐
│  User   │───►│  React UI   │───►│ POST /api/submit-    │───►│ Firestore │
│ Selects │    │ Predictions │    │ prediction           │    │           │
│ Drivers │    │   Page      │    │ (Server-side)        │    │ users/    │
└─────────┘    └─────────────┘    │                      │    │ {uid}/    │
                                  │ • Validates 6 drivers│    │predictions│
                                  │ • Checks race lockout│    │           │
                                  │ • Writes to subcoll  │    │ prediction│
                                  │ • Writes to flat coll│    │_submissions│
                                  │ • Logs audit event   │    │           │
                                  └──────────────────────┘    └───────────┘
```

### 2.3.2 Score Calculation Flow

```
┌─────────┐    ┌─────────────┐    ┌───────────────┐    ┌───────────┐
│  Admin  │───►│  Results    │───►│ Client-side   │───►│ Firestore │
│ Enters  │    │  Manager    │    │ Calculation   │    │           │
│ Top 6   │    │   Tab       │    │               │    │ race_     │
└─────────┘    └─────────────┘    │ • Query all   │    │ results/  │
                                  │   predictions │    │           │
                                  │ • Apply Prix  │    │ scores/   │
                                  │   Six rules   │    │           │
                                  │ • Write scores│    │           │
                                  └───────────────┘    └───────────┘
```

### 2.3.3 Error Handling Flow

```
┌─────────────┐    ┌──────────────────┐    ┌───────────────────┐
│ Firestore   │───►│ FirestorePermis- │───►│   errorEmitter    │
│ Operation   │    │ sionError        │    │   .emit()         │
│ (Failure)   │    │ (Wrapped)        │    │                   │
└─────────────┘    └──────────────────┘    └─────────┬─────────┘
                                                     │
                                           ┌─────────▼─────────┐
                                           │ FirebaseError     │
                                           │ Listener          │
                                           │ (Component)       │
                                           └─────────┬─────────┘
                                                     │
                                           ┌─────────▼─────────┐
                                           │ Error Boundary    │
                                           │ (throw)           │
                                           └───────────────────┘
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
│                     │  4. Check badLoginAttempts (lock at 5)            │   │
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

## 4.3 Firebase Provider Methods

```typescript
// Location: src/firebase/provider.tsx

interface FirebaseContextState {
  // State
  firebaseApp: FirebaseApp | null;
  firestore: Firestore | null;
  authService: Auth | null;
  user: User | null;
  firebaseUser: FirebaseAuthUser | null;
  isUserLoading: boolean;
  userError: Error | null;

  // Methods
  login(email: string, pin: string): Promise<AuthResult>;
  signup(email: string, teamName: string, pin?: string): Promise<AuthResult>;
  logout(): void;
  updateUser(userId: string, data: Partial<User>): Promise<AuthResult>;
  deleteUser(userId: string): Promise<AuthResult>;
  addSecondaryTeam(teamName: string): Promise<AuthResult>;
  resetPin(email: string): Promise<AuthResult>;
  changePin(email: string, newPin: string): Promise<AuthResult>;
}
```

### 4.3.1 Login Method

```typescript
async function login(email: string, pin: string): Promise<AuthResult> {
  // 1. Fetch user document by email (case-insensitive)
  // 2. Check badLoginAttempts >= 5 → return locked error
  // 3. signInWithEmailAndPassword(auth, email, pin)
  // 4. On success:
  //    - Reset badLoginAttempts to 0
  //    - Log 'login_success' audit event
  // 5. On failure:
  //    - Increment badLoginAttempts
  //    - Log 'login_fail_pin' or 'login_fail_locked' audit event
}
```

### 4.3.2 Signup Method

```typescript
async function signup(email: string, teamName: string, pin?: string): Promise<AuthResult> {
  // 1. Check admin_configuration/global.newUserSignupEnabled
  // 2. Validate email uniqueness (case-insensitive)
  // 3. Validate teamName uniqueness (case-insensitive across primary AND secondary)
  // 4. Generate 6-digit PIN if not provided
  // 5. createUserWithEmailAndPassword(auth, email, pin)
  // 6. Create user document with initial data
  // 7. Create presence document (sessions: [], online: false)
  // 8. POST /api/send-welcome-email { toEmail, teamName, pin }
  // 9. Log 'USER_REGISTERED' and 'signup_email_sent' audit events
}
```

### 4.3.3 Update User Method (Admin Only)

```typescript
async function updateUser(userId: string, data: Partial<User>): Promise<AuthResult> {
  // 1. Verify current user is admin
  // 2. Validate teamName uniqueness (skip current user)
  // 3. Update user document with merge
  // 4. Log 'admin_update_user' audit event
}
```

### 4.3.4 Delete User Method (Admin Only)

```typescript
async function deleteUser(userId: string): Promise<AuthResult> {
  // 1. Verify current user is admin
  // 2. Batch delete:
  //    - users/{userId} document
  //    - presence/{userId} document
  // 3. Log 'admin_delete_user' audit event
}
```

## 4.4 PIN Generation

```typescript
// Location: Signup page component

function generateRandomPin(): string {
  // Generate a random 6-digit PIN (100000-999999)
  return Math.floor(100000 + Math.random() * 900000).toString();
}
```

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
  isAdmin: boolean;              // Admin flag

  // Security
  mustChangePin: boolean;        // Force PIN reset on login
  badLoginAttempts: number;      // Failed login counter (max 5)

  // Preferences
  emailPreferences: {
    rankingChanges: boolean;     // Notify on rank changes
    raceReminders: boolean;      // Race reminder emails
    newsFeed: boolean;           // Hot news emails
    resultsNotifications: boolean; // Results published emails
  };

  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

## 4.6 Login Security

| Feature | Implementation |
|---------|----------------|
| **Lockout** | After 5 failed attempts, account is soft-locked |
| **PIN Reset** | Admin can set `mustChangePin: true` |
| **Session** | Firebase Auth manages JWT tokens |
| **Persistence** | `browserLocalPersistence` by default |

## 4.7 Protected Admin Accounts

```typescript
const PROTECTED_ADMIN_EMAILS = [
  'aaron@garcia.ltd',           // Primary admin
  'aaron.garcia@hotmail.co.uk'  // Secondary admin
];
```

These accounts cannot have admin status revoked or be deleted through the UI.

---

# 5. User-Facing Pages

## 5.1 Page Overview

| # | Route | Page Name | Purpose | Auth Required |
|---|-------|-----------|---------|---------------|
| 1 | `/login` | Login | User authentication | No |
| 2 | `/signup` | Sign Up | New user registration | No |
| 3 | `/forgot-pin` | Forgot PIN | PIN reset request | No |
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

### 5.2.2 Page Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    MAKE YOUR PREDICTION                          │   │
│  │  Australian Grand Prix - Melbourne                               │   │
│  │  Deadline: March 7, 2026 06:00 UTC                              │   │
│  │  ⏱️ Time remaining: 2d 14h 32m                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌───────────────────────────────┐  ┌───────────────────────────────┐  │
│  │                               │  │                               │  │
│  │   AVAILABLE DRIVERS (22)      │  │   YOUR PREDICTION             │  │
│  │                               │  │                               │  │
│  │   ┌─────┐ ┌─────┐ ┌─────┐    │  │   P1: [Verstappen      ] ✕   │  │
│  │   │ VER │ │ HAM │ │ NOR │    │  │   P2: [Hamilton        ] ✕   │  │
│  │   │ #3  │ │ #44 │ │ #1  │    │  │   P3: [Norris          ] ✕   │  │
│  │   └─────┘ └─────┘ └─────┘    │  │   P4: [Leclerc         ] ✕   │  │
│  │   ┌─────┐ ┌─────┐ ┌─────┐    │  │   P5: [Piastri         ] ✕   │  │
│  │   │ LEC │ │ PIA │ │ RUS │    │  │   P6: [Russell         ] ✕   │  │
│  │   │ #16 │ │ #81 │ │ #63 │    │  │                               │  │
│  │   └─────┘ └─────┘ └─────┘    │  │   [Submit Prediction]         │  │
│  │   ... (22 total drivers)     │  │                               │  │
│  │                               │  │                               │  │
│  └───────────────────────────────┘  └───────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.2.3 Driver Data (2026 Season - 22 Drivers)

```typescript
// Location: src/lib/data.ts

export interface Driver {
  id: string;       // Lowercase identifier (e.g., "verstappen")
  name: string;     // Display name
  number: number;   // Car number
  team: string;     // Team name
  imageId: string;  // Image reference
}

export const F1Drivers: Driver[] = [
  // Red Bull Racing
  { id: 'verstappen', name: 'Verstappen', number: 3, team: 'Red Bull Racing', imageId: 'max-verstappen' },
  { id: 'hadjar', name: 'Hadjar', number: 6, team: 'Red Bull Racing', imageId: 'isack-hadjar' },
  // Ferrari
  { id: 'leclerc', name: 'Leclerc', number: 16, team: 'Ferrari', imageId: 'charles-leclerc' },
  { id: 'hamilton', name: 'Hamilton', number: 44, team: 'Ferrari', imageId: 'lewis-hamilton' },
  // McLaren
  { id: 'norris', name: 'Norris', number: 1, team: 'McLaren', imageId: 'lando-norris' },
  { id: 'piastri', name: 'Piastri', number: 81, team: 'McLaren', imageId: 'oscar-piastri' },
  // Mercedes
  { id: 'russell', name: 'Russell', number: 63, team: 'Mercedes', imageId: 'george-russell' },
  { id: 'antonelli', name: 'Antonelli', number: 12, team: 'Mercedes', imageId: 'kimi-antonelli' },
  // Aston Martin
  { id: 'alonso', name: 'Alonso', number: 14, team: 'Aston Martin', imageId: 'fernando-alonso' },
  { id: 'stroll', name: 'Stroll', number: 18, team: 'Aston Martin', imageId: 'lance-stroll' },
  // Alpine
  { id: 'gasly', name: 'Gasly', number: 10, team: 'Alpine', imageId: 'pierre-gasly' },
  { id: 'colapinto', name: 'Colapinto', number: 43, team: 'Alpine', imageId: 'franco-colapinto' },
  // Williams
  { id: 'albon', name: 'Albon', number: 23, team: 'Williams', imageId: 'alexander-albon' },
  { id: 'sainz', name: 'Sainz', number: 55, team: 'Williams', imageId: 'carlos-sainz' },
  // Racing Bulls
  { id: 'lawson', name: 'Lawson', number: 30, team: 'Racing Bulls', imageId: 'liam-lawson' },
  { id: 'lindblad', name: 'Lindblad', number: 41, team: 'Racing Bulls', imageId: 'arvid-lindblad' },
  // Audi (formerly Sauber)
  { id: 'hulkenberg', name: 'Hulkenberg', number: 27, team: 'Audi', imageId: 'nico-hulkenberg' },
  { id: 'bortoleto', name: 'Bortoleto', number: 5, team: 'Audi', imageId: 'gabriel-bortoleto' },
  // Haas F1 Team
  { id: 'ocon', name: 'Ocon', number: 31, team: 'Haas F1 Team', imageId: 'esteban-ocon' },
  { id: 'bearman', name: 'Bearman', number: 87, team: 'Haas F1 Team', imageId: 'oliver-bearman' },
  // Cadillac F1 Team (11th team for 2026)
  { id: 'perez', name: 'Perez', number: 11, team: 'Cadillac F1 Team', imageId: 'sergio-perez' },
  { id: 'bottas', name: 'Bottas', number: 77, team: 'Cadillac F1 Team', imageId: 'valtteri-bottas' },
];
```

### 5.2.4 Prediction Submission API

**IMPORTANT:** Predictions are submitted via a server-side API route that enforces the race lockout:

```typescript
// Location: src/app/api/submit-prediction/route.ts

interface PredictionRequest {
  userId: string;
  teamId: string;
  teamName: string;
  raceId: string;
  raceName: string;
  predictions: string[];  // Array of 6 driver IDs
}

export async function POST(request: NextRequest) {
  const data: PredictionRequest = await request.json();

  // Validate required fields
  if (!userId || !teamId || !teamName || !raceId || !raceName || !predictions) {
    return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
  }

  // Validate predictions array
  if (!Array.isArray(predictions) || predictions.length !== 6) {
    return NextResponse.json({ success: false, error: 'Predictions must be an array of 6 driver IDs' }, { status: 400 });
  }

  // SERVER-SIDE LOCKOUT ENFORCEMENT
  const race = RaceSchedule.find(r => r.name === raceName || r.name.replace(/\s+/g, '-') === raceId);
  if (race) {
    const qualifyingTime = new Date(race.qualifyingTime).getTime();
    if (Date.now() > qualifyingTime) {
      return NextResponse.json(
        { success: false, error: 'Pit lane is closed. Predictions cannot be submitted after qualifying starts.' },
        { status: 403 }
      );
    }
  }

  // Write to user's predictions subcollection (array format)
  const predictionId = `${teamId}_${raceId}`;
  await db.collection('users').doc(userId).collection('predictions').doc(predictionId).set({
    id: predictionId,
    userId,
    teamId,
    teamName,
    raceId,
    raceName,
    predictions,  // Array: ["verstappen", "hamilton", ...]
    submissionTimestamp: FieldValue.serverTimestamp(),
  }, { merge: true });

  // Write to flat prediction_submissions collection (object format)
  await db.collection('prediction_submissions').add({
    userId,
    teamName,
    raceName,
    raceId,
    predictions: {
      P1: predictions[0],
      P2: predictions[1],
      P3: predictions[2],
      P4: predictions[3],
      P5: predictions[4],
      P6: predictions[5],
    },
    submittedAt: FieldValue.serverTimestamp(),
  });

  // Log audit event
  await db.collection('audit_logs').add({
    userId,
    action: 'prediction_submitted',
    details: { teamName, raceName, raceId, predictions },
    timestamp: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ success: true });
}
```

### 5.2.5 Dual Storage Format

**IMPORTANT:** Predictions are stored in TWO formats:

| Collection | Format | Purpose |
|------------|--------|---------|
| `users/{uid}/predictions/{id}` | Array `["ver", "ham", ...]` | User's own predictions |
| `prediction_submissions/{autoId}` | Object `{P1: "ver", P2: "ham", ...}` | Admin queries, audit trail |

## 5.3 Standings Page (`/standings`)

### 5.3.1 Purpose
Displays the current league standings with total points accumulated across all races.

### 5.3.2 Standings Calculation

```typescript
// Client-side aggregation from scores collection

interface StandingEntry {
  rank: number;
  teamName: string;
  totalPoints: number;
  racesCompleted: number;
}

function calculateStandings(scores: Score[], users: User[]): StandingEntry[] {
  // Group scores by user
  const userPoints = new Map<string, number>();
  const userRaces = new Map<string, number>();

  scores.forEach(score => {
    const current = userPoints.get(score.userId) || 0;
    userPoints.set(score.userId, current + score.totalPoints);

    const races = userRaces.get(score.userId) || 0;
    userRaces.set(score.userId, races + 1);
  });

  // Build standings array
  const standings: StandingEntry[] = users.map(user => ({
    rank: 0,
    teamName: user.teamName,
    totalPoints: userPoints.get(user.id) || 0,
    racesCompleted: userRaces.get(user.id) || 0,
  }));

  // Sort by points descending
  standings.sort((a, b) => b.totalPoints - a.totalPoints);

  // Assign ranks (handle ties)
  let currentRank = 1;
  standings.forEach((entry, index) => {
    if (index > 0 && entry.totalPoints < standings[index - 1].totalPoints) {
      currentRank = index + 1;
    }
    entry.rank = currentRank;
  });

  return standings;
}
```

## 5.4 About Page (`/about`)

### 5.4.1 Purpose
Displays application information, system status, and architecture documentation.

### 5.4.2 Actual Page Content

**IMPORTANT:** The About page is more comprehensive than a simple version display:

```typescript
// Location: src/app/(app)/about/page.tsx

const AboutPageClient = () => {
  const firestore = useFirestore();

  // Query registered teams count
  const { data: allUsers } = useCollection(query(collection(firestore, 'users')));

  // Query online users count
  const { data: presenceDocs } = useCollection<Presence>(query(collection(firestore, 'presence')));

  // Calculate total online sessions
  const onlineUserCount = presenceDocs
    ?.filter(doc => doc.sessions && doc.sessions.length > 0)
    .reduce((acc, doc) => acc + (doc.sessions?.length || 0), 0) || 0;

  // Load HLD/LLD from backend.json
  const hld = backendData.firestore.reasoning;
  const lld = backendData.firestore.structure;

  return (
    <div>
      {/* Version badge */}
      <span>v{APP_VERSION}</span>

      {/* Stats cards */}
      <Card>Registered Teams: {allUsers?.length ?? 0}</Card>
      <Card>Online Users: {onlineUserCount}</Card>

      {/* Architecture documentation */}
      <Card>
        <h3>High-Level Design (HLD)</h3>
        <p>{hld}</p>

        <h3>Low-Level Design (LLD) - Firestore Structure</h3>
        {lld.map(item => (
          <div key={item.path}>
            <h4>{item.path}</h4>
            <p>{item.definition.description}</p>
          </div>
        ))}
      </Card>

      {/* Support */}
      <Card>
        Contact: aaron@garcia.ltd
      </Card>
    </div>
  );
};
```

### 5.4.3 Version Management

```typescript
// Location: src/lib/version.ts

// Centralised version constant - update when bumping package.json
export const APP_VERSION = "1.10.0";
```

### 5.4.4 Backend.json Structure

```typescript
// Location: app/docs/backend.json

interface BackendData {
  firestore: {
    reasoning: string;  // HLD text displayed on About page
    structure: Array<{
      path: string;     // e.g., "/users/{userId}"
      definition: {
        description: string;
      };
    }>;
  };
}
```

## 5.5 Schedule Page (`/schedule`)

### 5.5.1 2026 F1 Calendar (24 Races)

```typescript
// Location: src/lib/data.ts

export const RaceSchedule: Race[] = [
  { name: "Australian Grand Prix", location: "Melbourne", raceTime: "2026-03-08T05:00:00Z", qualifyingTime: "2026-03-07T06:00:00Z", hasSprint: false },
  { name: "Chinese Grand Prix", location: "Shanghai", raceTime: "2026-03-15T07:00:00Z", qualifyingTime: "2026-03-13T07:00:00Z", sprintTime: "2026-03-14T07:00:00Z", hasSprint: true },
  { name: "Japanese Grand Prix", location: "Suzuka", raceTime: "2026-03-29T06:00:00Z", qualifyingTime: "2026-03-28T07:00:00Z", hasSprint: false },
  { name: "Bahrain Grand Prix", location: "Sakhir", raceTime: "2026-04-12T15:00:00Z", qualifyingTime: "2026-04-11T16:00:00Z", hasSprint: false },
  { name: "Saudi Arabian Grand Prix", location: "Jeddah", raceTime: "2026-04-19T17:00:00Z", qualifyingTime: "2026-04-18T17:00:00Z", hasSprint: false },
  { name: "Miami Grand Prix", location: "Miami", raceTime: "2026-05-03T20:00:00Z", qualifyingTime: "2026-05-01T21:00:00Z", sprintTime: "2026-05-02T20:00:00Z", hasSprint: true },
  { name: "Canadian Grand Prix", location: "Montreal", raceTime: "2026-05-24T18:00:00Z", qualifyingTime: "2026-05-22T20:00:00Z", sprintTime: "2026-05-23T18:00:00Z", hasSprint: true },
  { name: "Monaco Grand Prix", location: "Monaco", raceTime: "2026-06-07T13:00:00Z", qualifyingTime: "2026-06-06T14:00:00Z", hasSprint: false },
  { name: "Spanish Grand Prix", location: "Barcelona", raceTime: "2026-06-14T13:00:00Z", qualifyingTime: "2026-06-13T14:00:00Z", hasSprint: false },
  { name: "Austrian Grand Prix", location: "Spielberg", raceTime: "2026-06-28T13:00:00Z", qualifyingTime: "2026-06-27T14:00:00Z", hasSprint: false },
  { name: "British Grand Prix", location: "Silverstone", raceTime: "2026-07-05T14:00:00Z", qualifyingTime: "2026-07-03T15:00:00Z", sprintTime: "2026-07-04T14:00:00Z", hasSprint: true },
  { name: "Belgian Grand Prix", location: "Spa-Francorchamps", raceTime: "2026-07-19T13:00:00Z", qualifyingTime: "2026-07-18T14:00:00Z", hasSprint: false },
  { name: "Hungarian Grand Prix", location: "Budapest", raceTime: "2026-07-26T13:00:00Z", qualifyingTime: "2026-07-25T14:00:00Z", hasSprint: false },
  { name: "Dutch Grand Prix", location: "Zandvoort", raceTime: "2026-08-23T13:00:00Z", qualifyingTime: "2026-08-21T14:00:00Z", sprintTime: "2026-08-22T13:00:00Z", hasSprint: true },
  { name: "Italian Grand Prix", location: "Monza", raceTime: "2026-09-06T13:00:00Z", qualifyingTime: "2026-09-05T14:00:00Z", hasSprint: false },
  { name: "Spanish Grand Prix II", location: "Madrid", raceTime: "2026-09-13T13:00:00Z", qualifyingTime: "2026-09-12T14:00:00Z", hasSprint: false },
  { name: "Azerbaijan Grand Prix", location: "Baku", raceTime: "2026-09-26T11:00:00Z", qualifyingTime: "2026-09-25T12:00:00Z", hasSprint: false },
  { name: "Singapore Grand Prix", location: "Singapore", raceTime: "2026-10-11T12:00:00Z", qualifyingTime: "2026-10-09T13:00:00Z", sprintTime: "2026-10-10T12:00:00Z", hasSprint: true },
  { name: "United States Grand Prix", location: "Austin", raceTime: "2026-10-25T19:00:00Z", qualifyingTime: "2026-10-24T20:00:00Z", hasSprint: false },
  { name: "Mexican Grand Prix", location: "Mexico City", raceTime: "2026-11-01T20:00:00Z", qualifyingTime: "2026-10-31T21:00:00Z", hasSprint: false },
  { name: "Brazilian Grand Prix", location: "Sao Paulo", raceTime: "2026-11-08T17:00:00Z", qualifyingTime: "2026-11-07T18:00:00Z", hasSprint: false },
  { name: "Las Vegas Grand Prix", location: "Las Vegas", raceTime: "2026-11-21T06:00:00Z", qualifyingTime: "2026-11-20T06:00:00Z", hasSprint: false },
  { name: "Qatar Grand Prix", location: "Lusail", raceTime: "2026-11-29T14:00:00Z", qualifyingTime: "2026-11-28T15:00:00Z", hasSprint: false },
  { name: "Abu Dhabi Grand Prix", location: "Yas Marina", raceTime: "2026-12-06T13:00:00Z", qualifyingTime: "2026-12-05T14:00:00Z", hasSprint: false },
];
```

### 5.5.2 Sprint Weekends (6 Total in 2026)

| Race | Location | Sprint Date |
|------|----------|-------------|
| Chinese GP | Shanghai | March 14 |
| Miami GP | Miami | May 2 |
| Canadian GP | Montreal | May 23 |
| British GP | Silverstone | July 4 |
| Dutch GP | Zandvoort | August 22 |
| Singapore GP | Singapore | October 10 |

## 5.6 Profile Page (`/profile`)

### 5.6.1 Email Preferences Structure

```typescript
// Embedded in users/{uid} document

interface EmailPreferences {
  rankingChanges: boolean;       // Notify on rank change
  raceReminders: boolean;        // Reminder before races
  newsFeed: boolean;             // Hot news emails
  resultsNotifications: boolean; // When results published
}

// Default values (set at signup)
const defaultPreferences: EmailPreferences = {
  rankingChanges: true,
  raceReminders: true,
  newsFeed: true,
  resultsNotifications: true
};
```

---

# 6. Admin Dashboard

## 6.1 Overview

The Admin Dashboard is a comprehensive 10-tab interface for managing all aspects of the Prix Six application. Access is restricted to users with `isAdmin: true` in their user document.

### 6.1.1 Access Control

```typescript
// Admin check in AuthGuard
if (pathname.startsWith('/admin') && !userData?.isAdmin) {
  router.push('/dashboard');
  return;
}

// Protected admin accounts (cannot be modified)
const PROTECTED_ADMIN_EMAILS = [
  'aaron@garcia.ltd',           // Primary admin
  'aaron.garcia@hotmail.co.uk'  // Secondary admin
];
```

### 6.1.2 Tab Overview

| Tab # | Tab Name | Component | Purpose | Key Actions |
|-------|----------|-----------|---------|-------------|
| 1 | Site Functions | SiteFunctionsManager | Global site controls | Lock predictions, toggle features |
| 2 | Team Manager | TeamManager | User management | View/edit users, reset PINs |
| 3 | Results Manager | ResultsManager | Race results entry | Enter P1-P6, calculate scores |
| 4 | Scoring Manager | ScoringManager | Score management | View/recalculate scores |
| 5 | Hot News Manager | HotNewsManager | AI news content | Generate/edit/publish news |
| 6 | Online Users | OnlineUsersManager | User presence | View sessions, Single User Mode |
| 7 | Email Log | EmailLogManager | Email history | View sent emails |
| 8 | Audit Manager | AuditManager | Audit trail | View user actions |
| 9 | WhatsApp Manager | WhatsAppManager | WhatsApp alerts | Send messages, configure alerts |
| 10 | Consistency Checker | ConsistencyChecker | Data validation | Run checks, view issues |

## 6.2 Tab 3: Results Manager

### 6.2.1 Score Calculation Method

**IMPORTANT:** Score calculation happens **client-side** in the admin panel, not via an API endpoint. The admin:
1. Selects a race
2. Enters the top 6 finishers
3. Clicks "Submit Results & Calculate Scores"
4. Client-side code queries all predictions and calculates scores
5. Writes results to `race_results` collection
6. Writes individual scores to `scores` collection

### 6.2.2 Race Results Document

```typescript
// Collection: race_results
// Document ID: Normalised race ID (e.g., "Australian-Grand-Prix")

interface RaceResultDocument {
  id: string;
  raceId: string;
  driver1: string;  // P1 driver ID
  driver2: string;  // P2 driver ID
  driver3: string;  // P3 driver ID
  driver4: string;  // P4 driver ID
  driver5: string;  // P5 driver ID
  driver6: string;  // P6 driver ID
  submittedAt: Timestamp;
  submittedBy: string;  // Admin user ID
}
```

## 6.3 Tab 5: Hot News Manager

### 6.3.1 Features

- Manual content editor with toggle
- "Refresh Now" button triggers AI hot-news-feed flow
- Sends email notifications to subscribers
- Tracks last update timestamp
- Logs `UPDATE_HOT_NEWS` audit event with content preview

### 6.3.2 Email Notification API

```typescript
// POST /api/send-hot-news-email

interface HotNewsEmailRequest {
  content: string;
  updatedBy: string;
  updatedByEmail: string;
}
```

## 6.4 Tab 6: Online Users Manager

### 6.4.1 Single User Mode

**Purpose:** Allows admin to isolate themselves as the only active user for maintenance operations.

```typescript
// Collection: admin_configuration
// Document: global

interface GlobalConfig {
  newUserSignupEnabled: boolean;
  singleUserModeEnabled: boolean;
  singleUserAdminId: string | null;
  singleUserModeActivatedAt: string | null; // ISO timestamp
}
```

**Activation Flow:**
1. Admin clicks "Activate Single User Mode" (destructive action)
2. All non-admin sessions are purged from presence collection
3. `singleUserModeEnabled` set to `true`
4. `singleUserAdminId` set to current admin's UID
5. App layout checks this on every render; non-designated users forced to logout
6. Logs `SINGLE_USER_MODE_ACTIVATED` audit event

**Deactivation Flow:**
1. Admin clicks "Deactivate Single User Mode"
2. `singleUserModeEnabled` set to `false`
3. `singleUserAdminId` cleared
4. Logs `SINGLE_USER_MODE_DEACTIVATED` audit event

## 6.5 Tab 9: WhatsApp Manager Configuration

```typescript
// Collection: admin_configuration
// Document: whatsapp_alerts

interface WhatsAppAlertSettings {
  masterEnabled: boolean;
  testMode: boolean;
  targetGroup: string;
  alerts: {
    // Race Weekend
    qualifyingReminder: boolean;
    raceReminder: boolean;
    resultsPublished: boolean;
    // Player Activity
    newPlayerJoined: boolean;
    predictionSubmitted: boolean;
    latePredictionWarning: boolean;
    // League Summary
    weeklyStandingsUpdate: boolean;
    endOfSeasonSummary: boolean;
    // Admin/Manual
    hotNewsPublished: boolean;
    adminAnnouncements: boolean;
    customMessages: boolean;
  };
  lastUpdated: Timestamp;
  updatedBy: string;
}
```

## 6.6 Tab 10: Consistency Checker

### 6.6.1 Check Categories (7 Total)

| Category | What It Checks | Total Expected |
|----------|----------------|----------------|
| **Users** | Required fields, email format, unique team names | ~20 |
| **Drivers** | All F1 drivers present, valid IDs, no duplicates | **22** |
| **Races** | All races in calendar, valid dates | **24** |
| **Predictions** | Valid driver IDs, 6 drivers per prediction | Variable |
| **Results** | Valid race ID, 6 unique drivers | Variable |
| **Scores** | Correct calculation per Prix Six rules | Variable |
| **Standings** | Points sum correctly | ~20 |

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

## 7.2 Dual Prediction Storage Format

**CRITICAL:** Predictions are stored in TWO different formats:

| Collection | Document ID | Format | Purpose |
|------------|-------------|--------|---------|
| `users/{uid}/predictions/{id}` | `{teamId}_{raceId}` | Array: `["ver", "ham", ...]` | User's own predictions |
| `prediction_submissions/{autoId}` | Auto-generated | Object: `{P1: "ver", P2: "ham", ...}` | Admin queries, audit |

### 7.2.1 Subcollection Format (Array)

```typescript
// Path: users/{userId}/predictions/{predictionId}
{
  id: "abc123_Australian-Grand-Prix",
  userId: "abc123",
  predictions: ["verstappen", "hamilton", "norris", "leclerc", "piastri", "russell"],
  submissionTimestamp: Timestamp
}
```

### 7.2.2 Flat Collection Format (Object)

```typescript
// Path: prediction_submissions/{autoId}
{
  userId: "abc123",
  teamName: "Speed Demons",
  predictions: {
    P1: "verstappen",
    P2: "hamilton",
    P3: "norris",
    P4: "leclerc",
    P5: "piastri",
    P6: "russell"
  },
  submittedAt: Timestamp
}
```

## 7.3 Collection: scores

```typescript
// Path: scores/{raceId}_{userId}
// Document ID: Composite key

interface ScoreDocument {
  id: string;
  userId: string;
  oduserId: string;     // Legacy compatibility
  raceId: string;
  totalPoints: number;  // 0-40
  breakdown: string;    // Human-readable
  calculatedAt?: Timestamp;
}
```

## 7.4 Collection: presence

```typescript
// Path: presence/{userId}

interface PresenceDocument {
  id: string;           // Firebase Auth UID
  online: boolean;      // Legacy - use sessions.length > 0
  sessions: string[];   // Array of active session GUIDs
}
```

**Session Tracking:**
- Each browser tab generates a unique session GUID on mount
- Session added to `sessions` array on login
- Session removed from array on logout or unmount
- Multiple sessions per user supported (multi-device)

## 7.5 Collection: email_daily_stats

```typescript
// Path: email_daily_stats/{dateId}
// Document ID: "YYYY-MM-DD"

interface DailyEmailStats {
  date: string;
  totalSent: number;
  emailsSent: EmailLogEntry[];
  summaryEmailSent: boolean;
}
```

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

## 8.2 Scoring Algorithm

```typescript
// Location: src/lib/scoring.ts

const PRIX_SIX_SCORING = {
  exactPosition: 5,       // Each driver in exact predicted position
  wrongPosition: 3,       // Each driver in top 6 but wrong position
  bonusAll6: 10,          // All 6 predictions in top 6 (regardless of order)
};

export async function calculateRaceScores(
  firestore: Firestore,
  raceResult: RaceResult
): Promise<{ userId: string; totalPoints: number; breakdown: string }[]> {
  // 1. Normalise race ID (remove " - GP"/" - Sprint" suffix)
  const normalizedRaceId = normalizeRaceId(raceResult.raceId);

  // 2. Build actual results array
  const actualResults = [
    raceResult.driver1,
    raceResult.driver2,
    raceResult.driver3,
    raceResult.driver4,
    raceResult.driver5,
    raceResult.driver6,
  ];

  // 3. Query predictions via collectionGroup query
  let predictions = await collectionGroup(firestore, 'predictions')
    .where('raceId', '==', normalizedRaceId)
    .get();

  // 4. Fallback to prediction_submissions if collectionGroup returns 0
  if (predictions.empty) {
    predictions = await collection(firestore, 'prediction_submissions')
      .where('raceId', '==', normalizedRaceId)
      .get();
  }

  // 5. Calculate score for each prediction
  const results = predictions.docs.map(doc => {
    const predicted = doc.data().predictions; // Array or Object
    const predictedArray = Array.isArray(predicted)
      ? predicted
      : [predicted.P1, predicted.P2, predicted.P3, predicted.P4, predicted.P5, predicted.P6];

    let points = 0;
    let exactCount = 0;
    let wrongPosCount = 0;
    const breakdown: string[] = [];

    for (let i = 0; i < 6; i++) {
      const actualIndex = actualResults.indexOf(predictedArray[i]);

      if (actualIndex === i) {
        // Exact position match
        points += PRIX_SIX_SCORING.exactPosition;
        exactCount++;
        breakdown.push(`P${i+1} ${predictedArray[i]}: +5 (exact)`);
      } else if (actualIndex !== -1) {
        // In top 6 but wrong position
        points += PRIX_SIX_SCORING.wrongPosition;
        wrongPosCount++;
        breakdown.push(`P${i+1} ${predictedArray[i]}: +3 (in top 6)`);
      } else {
        breakdown.push(`P${i+1} ${predictedArray[i]}: +0 (not in top 6)`);
      }
    }

    // Bonus for all 6 correct
    if (exactCount + wrongPosCount === 6) {
      points += PRIX_SIX_SCORING.bonusAll6;
      breakdown.push(`All 6 bonus: +10`);
    }

    return {
      userId: doc.data().userId,
      totalPoints: points,
      breakdown: breakdown.join('; '),
    };
  });

  return results;
}
```

## 8.3 Race ID Normalisation

```typescript
// Location: src/lib/scoring.ts, src/lib/consistency.ts

export function normalizeRaceId(raceName: string): string {
  return raceName
    .replace(/\s*-\s*GP$/i, '')      // Remove " - GP" suffix
    .replace(/\s*-\s*Sprint$/i, '')  // Remove " - Sprint" suffix
    .replace(/\s+/g, '-');            // Replace spaces with dashes
}

// "Australian Grand Prix - GP" → "Australian-Grand-Prix"
// "Chinese Grand Prix - Sprint" → "Chinese-Grand-Prix"
```

---

# 9. Email Notification System

## 9.1 API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/send-welcome-email` | POST | Send welcome email with PIN |
| `/api/send-results-email` | POST | Send race results notification |
| `/api/send-hot-news-email` | POST | Send hot news to subscribers |
| `/api/email-queue` | POST | Process queued emails |

## 9.2 Rate Limiting

```typescript
// Location: src/lib/email-tracking.ts

const DAILY_GLOBAL_LIMIT = 30;      // Max emails/day (entire app)
const DAILY_PER_ADDRESS_LIMIT = 5;  // Max emails/day per recipient
const ADMIN_EMAIL = 'aaron@garcia.ltd'; // Exempt from per-address limit
```

## 9.3 Microsoft Graph Integration

Uses OAuth2 Client Credentials flow with:
- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `FROM_EMAIL` (sender address)

---

# 10. WhatsApp Integration System

## 10.1 Architecture

```
┌─────────────┐     ┌───────────────────┐     ┌──────────────────┐
│  Admin UI   │────►│  whatsapp_queue   │────►│  WhatsApp Worker │
│  (React)    │     │  (Firestore)      │     │  (Azure ACI)     │
└─────────────┘     └───────────────────┘     └────────┬─────────┘
                                                       │
                                              ┌────────▼─────────┐
                                              │  WhatsApp Web    │
                                              │  (whatsapp-web.js)│
                                              └──────────────────┘
```

## 10.2 Message Queue Document

```typescript
// Collection: whatsapp_queue

interface QueueMessage {
  id: string;
  groupName?: string;
  chatId?: string;
  message: string;
  status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';
  testMode?: boolean;
  sentBy: string;
  retryCount: number;
  createdAt: Timestamp;
  processedAt?: Timestamp;
  error?: string;
}
```

## 10.3 Alert History Document

```typescript
// Collection: whatsapp_alert_history

interface WhatsAppAlertHistoryEntry {
  alertType: string;
  message: string;
  targetGroup: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  testMode: boolean;
  createdAt: Timestamp;
  processedAt?: Timestamp;
  error?: string;
  sentBy?: string;
}
```

---

# 11. WhatsApp Worker Service

## 11.1 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   WHATSAPP WORKER (Azure ACI)                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────┐  │
│   │   Express       │   │  WhatsApp       │   │   Queue     │  │
│   │   Server        │   │  Client         │   │   Processor │  │
│   │   (Port 3000)   │   │  (wweb.js)      │   │             │  │
│   └────────┬────────┘   └────────┬────────┘   └──────┬──────┘  │
│            │                     │                    │         │
│   Health Endpoints:              │                    │         │
│   • GET /health                  │                    │         │
│   • GET /status                  │                    │         │
│   • GET /qr                      ▼                    ▼         │
│                          ┌─────────────┐     ┌─────────────┐   │
│                          │  Puppeteer  │     │  Firestore  │   │
│                          │  (Chromium) │     │  Listener   │   │
│                          └─────────────┘     └─────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                    │
                    ▼
        ┌─────────────────────┐
        │  Azure Blob Storage │
        │  (Session Persist)  │
        └─────────────────────┘
```

## 11.2 Platform Detection

```typescript
// Location: whatsapp-worker/src/whatsapp-client.ts

// Detect Windows vs Linux for different Puppeteer configs
const isWindows = process.platform === 'win32';
const useAzureStorage = !!process.env.AZURE_STORAGE_CONNECTION_STRING;

// Windows (local dev): LocalAuth, fewer Puppeteer restrictions
// Linux (Azure): RemoteAuth with Azure Blob, more Puppeteer flags
```

## 11.3 Rate Limiting Constants

```typescript
// Location: whatsapp-worker/src/queue-processor.ts

private readonly MIN_DELAY_MS = 5000;   // 5 seconds between messages
private readonly MAX_DELAY_MS = 10000;  // 10 seconds max delay
private readonly MAX_RETRIES = 3;       // Max retry attempts
```

## 11.4 Dockerfile

```dockerfile
FROM node:20-bookworm-slim

WORKDIR /app

# Install Chromium dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    # ... (many Chromium deps)
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Non-root user for security
RUN groupadd -r pptruser && useradd -r -g pptruser pptruser
USER pptruser

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
```

---

# 12. Consistency Checker

## 12.1 Check Types and Validation

```typescript
// Location: src/lib/consistency.ts

export type CheckCategory = 'users' | 'drivers' | 'races' | 'predictions' | 'results' | 'scores' | 'standings';
export type CheckStatus = 'pass' | 'warning' | 'error';

export interface CheckResult {
  category: CheckCategory;
  status: CheckStatus;
  total: number;
  valid: number;
  issues: Issue[];
}

export interface Issue {
  id: string;
  message: string;
  severity: 'warning' | 'error';
}
```

## 12.2 Validation Functions

### 12.2.1 Check Users
- Email format validation (regex)
- Team name uniqueness (case-insensitive)
- Required fields present (email, teamName, id)

### 12.2.2 Check Drivers
- All 22 F1 drivers from static data exist
- No duplicate driver IDs
- Valid team assignments

### 12.2.3 Check Races
- All 24 races from schedule present
- Valid date formats (ISO 8601)
- Sprint races have sprintTime

### 12.2.4 Check Predictions
- 6 drivers per prediction
- All driver IDs valid (exist in F1Drivers)
- Race ID matches existing race
- No duplicate drivers in prediction

### 12.2.5 Check Scores
- Points calculation matches Prix Six rules
- Score exists for each prediction + result pair
- Points within valid range (0-40)

## 12.3 Correlation ID Format

```typescript
// Format: cc_{timestamp}_{random}
// Example: cc_1768954664712_1u8qrk

export function generateConsistencyCorrelationId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `cc_${timestamp}_${random}`;
}
```

## 12.4 Score Verification Algorithm

```typescript
function calculateExpectedScore(predicted: string[], actual: string[]): number {
  let points = 0;
  let correctCount = 0;

  for (let i = 0; i < predicted.length; i++) {
    const actualIndex = actual.indexOf(predicted[i]);
    if (actualIndex === i) {
      points += 5;  // Exact
      correctCount++;
    } else if (actualIndex !== -1) {
      points += 3;  // Wrong position
      correctCount++;
    }
  }

  if (correctCount === 6) points += 10;  // Bonus
  return points;
}
```

---

# 13. Audit System

## 13.1 Correlation ID Management

```typescript
// Location: src/lib/audit.ts

let sessionCorrelationId: string | null = null;

export function getCorrelationId(): string {
  if (!sessionCorrelationId) {
    sessionCorrelationId = generateGuid();
  }
  return sessionCorrelationId;
}

export function generateGuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
```

## 13.2 Core Audit Functions

```typescript
export async function logAuditEvent(
  firestore: Firestore,
  userId: string | undefined,
  action: string,
  details: object
): Promise<void> {
  await addDoc(collection(firestore, 'audit_logs'), {
    userId: userId || 'anonymous',
    action,
    details,
    correlationId: getCorrelationId(),
    timestamp: serverTimestamp(),
  });
}

export function useAuditNavigation(): void {
  // React hook that logs page navigation
  // Logs initial page load with { path, initial_load: true }
  // Logs subsequent navigation with { path }
}

export function logPermissionError(
  firestore: Firestore,
  userId: string | undefined,
  error: FirestorePermissionError
): void {
  // Console log only - avoids circular permission errors
  console.error('[Permission Error]', error.message);
}
```

## 13.3 Common Action Types

| Action Type | Trigger | Details |
|-------------|---------|---------|
| `navigate` | Page change | `{ path, initial_load? }` |
| `login_success` | Successful login | `{ email }` |
| `login_fail_pin` | Wrong PIN | `{ email }` |
| `login_fail_locked` | Account locked | `{ email }` |
| `signup_email_sent` | Welcome email | `{ email }` |
| `USER_REGISTERED` | Registration | `{ email, teamName }` |
| `prediction_submitted` | Submit prediction | `{ raceId, predictions }` |
| `admin_update_user` | Admin edits user | `{ targetUserId, changes }` |
| `admin_delete_user` | Admin deletes user | `{ targetUserId }` |
| `add_secondary_team` | Add secondary name | `{ teamName }` |
| `reset_pin_email_queued` | PIN reset requested | `{ email }` |
| `pin_changed` | PIN changed | `{ email }` |
| `UPDATE_HOT_NEWS` | Hot news updated | `{ contentPreview }` |
| `SEND_HOT_NEWS_EMAILS` | Email batch sent | `{ totalSubscribers, emailsSent }` |
| `SINGLE_USER_MODE_ACTIVATED` | Single user mode on | `{ adminId }` |
| `SINGLE_USER_MODE_DEACTIVATED` | Single user mode off | `{}` |
| `logout` | User logout | `{}` |

---

# 14. Session Management System

## 14.1 Session Context

```typescript
// Location: src/contexts/session-context.tsx

interface SessionContextState {
  sessionId: string | null;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    // Generate unique session GUID on mount
    setSessionId(generateGuid());
  }, []);

  return (
    <SessionContext.Provider value={{ sessionId }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextState {
  return useContext(SessionContext);
}
```

## 14.2 Session Lifecycle

### 14.2.1 Session Creation
1. User navigates to authenticated route
2. App layout mounts, generates session GUID
3. Session added to user's `presence/{userId}.sessions` array

### 14.2.2 Session Maintenance
- Session ID passed via context to all components
- Used for correlation in audit events
- Multiple sessions per user allowed (multi-device)

### 14.2.3 Session Cleanup
1. User logs out → session removed from array
2. Component unmount → session removed from array
3. Admin activates Single User Mode → all sessions purged except admin

## 14.3 Presence Document Updates

```typescript
// On login
await updateDoc(presenceRef, {
  sessions: arrayUnion(sessionId),
  online: true,
});

// On logout
await updateDoc(presenceRef, {
  sessions: arrayRemove(sessionId),
  online: sessions.length === 1 ? false : true,
});
```

---

# 15. Error Handling Architecture

## 15.1 Error Classes

```typescript
// Location: src/firebase/errors.ts

interface SecurityRuleRequest {
  auth: {
    uid: string;
    token: object;
  } | null;
  method: 'get' | 'list' | 'create' | 'update' | 'delete' | 'write';
  path: string;
  resource?: {
    data: object;
  };
}

interface SecurityRuleContext {
  user: User | null;
  firebaseUser: FirebaseAuthUser | null;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete' | 'write';
  path: string;
  requestData?: object;
  originalError: Error;
}

export class FirestorePermissionError extends Error {
  public readonly request: SecurityRuleRequest;

  constructor(context: SecurityRuleContext) {
    // Builds error message with simulated Firestore request object
    // Mirrors security rules request structure for LLM debugging
    super(`Permission denied for ${context.operation} on ${context.path}`);
    this.request = buildRequest(context);
  }
}
```

**Purpose:** Enable LLM debugging of permission errors by structuring error like Firestore security rules context.

## 15.2 Error Event Emitter

```typescript
// Location: src/firebase/error-emitter.ts

export interface AppEvents {
  'permission-error': FirestorePermissionError;
}

type Callback<T> = (data: T) => void;

function createEventEmitter<Events extends Record<string, unknown>>() {
  const listeners = new Map<keyof Events, Set<Callback<unknown>>>();

  return {
    on<K extends keyof Events>(event: K, callback: Callback<Events[K]>) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(callback as Callback<unknown>);
    },
    off<K extends keyof Events>(event: K, callback: Callback<Events[K]>) {
      listeners.get(event)?.delete(callback as Callback<unknown>);
    },
    emit<K extends keyof Events>(event: K, data: Events[K]) {
      listeners.get(event)?.forEach(cb => cb(data));
    },
  };
}

export const errorEmitter = createEventEmitter<AppEvents>();
```

## 15.3 Firebase Error Listener Component

```typescript
// Location: src/components/FirebaseErrorListener.tsx

export function FirebaseErrorListener() {
  const [error, setError] = useState<FirestorePermissionError | null>(null);

  useEffect(() => {
    const handleError = (err: FirestorePermissionError) => {
      // Log to console
      console.error('[Permission Error]', err);

      // Set state to trigger re-render and throw
      setError(err);
    };

    errorEmitter.on('permission-error', handleError);
    return () => errorEmitter.off('permission-error', handleError);
  }, []);

  // Throw error to trigger Next.js error boundary
  if (error) {
    throw error;
  }

  return null; // Invisible component
}
```

## 15.4 Error Flow

```
1. Firestore operation fails (permission denied)
         ↓
2. Catch block wraps error in FirestorePermissionError
         ↓
3. errorEmitter.emit('permission-error', error)
         ↓
4. FirebaseErrorListener receives event
         ↓
5. Component sets error state, re-renders
         ↓
6. throw error (on next render)
         ↓
7. Next.js error boundary catches and displays error UI
```

## 15.5 Error Logging to Firestore

```typescript
// Location: src/lib/firebase-admin.ts

export async function logError(options: {
  correlationId: string;
  error: Error | string;
  context: {
    route?: string;
    action?: string;
    userId?: string;
    requestData?: unknown;
    userAgent?: string;
    ip?: string;
    additionalInfo?: Record<string, unknown>;
  };
}): Promise<void> {
  const { db } = await getFirebaseAdmin();

  await db.collection('error_logs').add({
    correlationId: options.correlationId,
    type: options.error instanceof Error ? options.error.name : 'Error',
    error: options.error instanceof Error ? options.error.message : options.error,
    stack: options.error instanceof Error ? options.error.stack : undefined,
    context: options.context,
    timestamp: FieldValue.serverTimestamp(),
    createdAt: new Date().toISOString(),
  });
}
```

---

# 16. React Patterns & Custom Hooks

## 16.1 Firestore Collection Hook

```typescript
// Location: src/firebase/firestore/use-collection.ts

export interface UseCollectionResult<T> {
  data: WithId<T>[] | null;      // Array of docs with ID field added
  isLoading: boolean;             // True while fetching
  error: FirestoreError | Error | null;
}

export function useCollection<T>(
  memoizedTargetRefOrQuery: CollectionReference | Query | null | undefined
): UseCollectionResult<T> {
  // CRITICAL: Input MUST be memoized with useMemo
  // Enforced with __memo flag warning

  const [data, setData] = useState<WithId<T>[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!memoizedTargetRefOrQuery) {
      setData(null);
      setIsLoading(false);
      return;
    }

    // Check for memoization
    if (!(memoizedTargetRefOrQuery as any).__memo) {
      console.warn('useCollection: Query/ref should be memoized with useMemo');
    }

    const unsubscribe = onSnapshot(
      memoizedTargetRefOrQuery,
      (snapshot) => {
        const docs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        } as WithId<T>));
        setData(docs);
        setIsLoading(false);
      },
      (err) => {
        // Wrap in contextual error
        const contextualError = new FirestorePermissionError({
          user: currentUser,
          firebaseUser: firebaseUser,
          operation: 'list',
          path: getPathFromRef(memoizedTargetRefOrQuery),
          originalError: err,
        });

        // Emit to global handler
        errorEmitter.emit('permission-error', contextualError);

        setError(contextualError);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [memoizedTargetRefOrQuery]);

  return { data, isLoading, error };
}
```

## 16.2 Firestore Document Hook

```typescript
// Location: src/firebase/firestore/use-doc.ts

export interface UseDocResult<T> {
  data: WithId<T> | null;         // Single doc with ID, or null
  isLoading: boolean;
  error: FirestoreError | Error | null;
}

export function useDoc<T>(
  memoizedDocRef: DocumentReference | null | undefined
): UseDocResult<T> {
  // Same memoization requirements as useCollection
  // Returns null if document doesn't exist (not an error)
  // Similar error emission pattern
}
```

## 16.3 Memoization Pattern

**CRITICAL:** All collection/document references passed to hooks MUST be wrapped in `useMemo`:

```typescript
// CORRECT
const usersQuery = useMemo(() => {
  const q = query(collection(firestore, 'users'), where('isAdmin', '==', true));
  (q as any).__memo = true;
  return q;
}, [firestore]);

const { data: admins } = useCollection<User>(usersQuery);

// INCORRECT - Will cause infinite re-renders
const { data: admins } = useCollection<User>(
  query(collection(firestore, 'users'), where('isAdmin', '==', true))
);
```

## 16.4 Non-Blocking Operations

### 16.4.1 Non-Blocking Auth

```typescript
// Location: src/firebase/non-blocking-login.ts

export function initiateAnonymousSignIn(auth: Auth): void {
  // Fire-and-forget - don't await
  signInAnonymously(auth).catch(console.error);
}

export function initiateEmailSignUp(auth: Auth, email: string, password: string): void {
  createUserWithEmailAndPassword(auth, email, password).catch(console.error);
}

export function initiateEmailSignIn(auth: Auth, email: string, password: string): void {
  signInWithEmailAndPassword(auth, email, password).catch(console.error);
}
```

### 16.4.2 Non-Blocking Firestore

```typescript
// Location: src/firebase/non-blocking-updates.ts

export function setDocumentNonBlocking<T>(
  docRef: DocumentReference<T>,
  data: Partial<T>,
  options?: SetOptions
): void {
  setDoc(docRef, data, options || {}).catch((err) => {
    const contextualError = new FirestorePermissionError({
      operation: 'write',
      path: docRef.path,
      requestData: data,
      originalError: err,
    });
    errorEmitter.emit('permission-error', contextualError);
  });
}

export function updateDocumentNonBlocking<T>(
  docRef: DocumentReference<T>,
  data: Partial<T>
): void {
  updateDoc(docRef, data).catch((err) => {
    const contextualError = new FirestorePermissionError({
      operation: 'update',
      path: docRef.path,
      requestData: data,
      originalError: err,
    });
    errorEmitter.emit('permission-error', contextualError);
  });
}

export function deleteDocumentNonBlocking<T>(
  docRef: DocumentReference<T>
): void {
  deleteDoc(docRef).catch((err) => {
    const contextualError = new FirestorePermissionError({
      operation: 'delete',
      path: docRef.path,
      originalError: err,
    });
    errorEmitter.emit('permission-error', contextualError);
  });
}
```

---

# 17. AI/Genkit Integration

## 17.1 Genkit Initialization

```typescript
// Location: src/ai/genkit.ts

import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

export const ai = genkit({
  plugins: [googleAI()],
  model: 'googleai/gemini-2.5-flash',
});
```

## 17.2 AI Flows

### 17.2.1 Team Name Generator

```typescript
// Location: src/ai/flows/team-name-generator.ts

interface TeamNameInput {
  existingTeamName: string;
}

interface TeamNameOutput {
  teamName: string;
}

const teamNamePrompt = ai.definePrompt({
  name: 'team-name-generator',
  input: { schema: TeamNameInputSchema },
  output: { schema: TeamNameOutputSchema },
  config: {
    temperature: 0.9,  // High creativity
  },
}, `Generate a punny F1-themed team name based on: {{existingTeamName}}

Requirements:
- Must be F1-related pun or wordplay
- Should be funny/clever
- 2-4 words max
- Family-friendly

Return only the team name, nothing else.`);

export async function generateTeamName(input: TeamNameInput): Promise<TeamNameOutput> {
  const result = await teamNamePrompt(input);
  return result.output;
}
```

### 17.2.2 Hot News Feed

```typescript
// Location: src/ai/flows/hot-news-feed.ts

interface HotNewsFeedOutput {
  newsFeed: string;
  lastUpdated?: string;
}

export async function getHotNewsFeed(): Promise<HotNewsFeedOutput> {
  // Reads from Firestore app-settings/hot-news
  // Returns cached content (AI refresh is manual only)
  const doc = await getDoc(doc(firestore, 'app-settings', 'hot-news'));

  if (doc.exists()) {
    return {
      newsFeed: doc.data().content || 'No hot news available.',
      lastUpdated: doc.data().lastUpdated?.toDate().toISOString(),
    };
  }

  return { newsFeed: 'No hot news available.' };
}

// Manual refresh flow (triggered by admin)
export const hotNewsFeedFlow = ai.defineFlow({
  name: 'hot-news-feed',
  inputSchema: z.object({}),
  outputSchema: HotNewsFeedOutputSchema,
}, async () => {
  // AI generates fresh F1 news content
  const result = await ai.generate({
    prompt: `Generate exciting F1 news update for fans...`,
  });

  return { newsFeed: result.text };
});
```

### 17.2.3 Dynamic Driver Updates

```typescript
// Location: src/ai/flows/dynamic-driver-updates.ts

// Tool for scraping F1 driver list
const scrapeF1DriversTool = ai.defineTool({
  name: 'scrape-f1-drivers',
  description: 'Scrape the official F1 website for current driver list',
  inputSchema: z.object({}),
  outputSchema: z.array(z.object({
    name: z.string(),
    team: z.string(),
    number: z.number(),
  })),
}, async () => {
  // Placeholder - actual implementation needs HTML parser
  return [];
});

// Flow for updating driver list
export const updateDriverListFlow = ai.defineFlow({
  name: 'update-driver-list',
  inputSchema: z.object({}),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
}, async () => {
  const drivers = await scrapeF1DriversTool({});
  // Update Firestore with new driver data
  return { success: true, message: `Updated ${drivers.length} drivers` };
});
```

## 17.3 Genkit Development

```bash
# Start Genkit dev server
npm run genkit:dev

# Watch mode
npm run genkit:watch
```

Genkit UI available at `http://localhost:4000` for testing flows.

---

# 18. Claude Coordination System

## 18.1 Session Naming

- **First session:** Bob
- **Second session:** Bill
- **Third+ sessions:** Guest-3, Guest-4, etc.

## 18.2 Commands

| Command | Usage | Description |
|---------|-------|-------------|
| `checkin` | `node claude-sync.js checkin` | Register session |
| `checkout` | `node claude-sync.js checkout "summary"` | End session |
| `read` | `node claude-sync.js read` | Display state |
| `write` | `node claude-sync.js write "message"` | Log activity |
| `claim` | `node claude-sync.js claim /path/` | Claim file |
| `release` | `node claude-sync.js release /path/` | Release file |

## 18.3 Coordination Document

```typescript
// Collection: coordination
// Document: claude-state

interface ClaudeState {
  sessions: {
    [sessionId: string]: {
      name: string;
      branch: string;
      checkedInAt: string;
      lastActivity: string;
    };
  };
  claimedPaths: {
    [path: string]: string; // session ID
  };
  log: Array<{
    timestamp: string;
    session: string;
    message: string;
  }>;
  lastUpdated: Timestamp;
}
```

---

# 19. ID Conventions and Data Standards

## 19.1 ID Format Summary

| Entity | Format | Example |
|--------|--------|---------|
| User | Firebase Auth UID | `abc123xyz789` |
| Driver | Lowercase name | `verstappen` |
| Race | Dash-separated | `Australian-Grand-Prix` |
| Prediction | `{teamId}_{raceId}` | `abc123_Australian-Grand-Prix` |
| Score | `{raceId}_{userId}` | `Australian-Grand-Prix_abc123` |
| Session | GUID | `550e8400-e29b-41d4-a716-446655440000` |
| Correlation ID (Audit) | GUID | `550e8400-e29b-...` |
| Correlation ID (CC) | `cc_{ts}_{rand}` | `cc_1768954664712_1u8qrk` |
| Correlation ID (Error) | `err_{ts}_{rand}` | `err_m2abc3_xyz123` |

## 19.2 Timestamp Formats

| Context | Format | Example |
|---------|--------|---------|
| Firestore | `Timestamp` object | `Timestamp.fromDate(new Date())` |
| ISO String | ISO 8601 | `"2026-01-21T14:30:00.000Z"` |
| Display (UK) | Localised | `"21/01/2026, 14:30"` |
| Date only | YYYY-MM-DD | `"2026-01-21"` |

---

# 20. Security Architecture

## 20.1 Firestore Security Rules

```javascript
// Location: app/src/firestore.rules

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

    // Users
    match /users/{userId} {
      allow get: if isOwner(userId) || isAdmin();
      allow list: if isSignedIn();
      allow create: if isOwner(userId);
      allow update: if isOwner(userId) || isAdmin();
      allow delete: if isOwner(userId);

      match /predictions/{predictionId} {
        allow read: if isSignedIn();
        allow write: if isOwner(userId) || isAdmin();
      }
    }

    // Admin-only collections
    match /race_results/{doc} {
      allow read: if true;
      allow write: if isAdmin();
    }

    match /admin_configuration/{doc} {
      allow read, write: if isAdmin();
    }

    match /scores/{doc} {
      allow read: if true;
      allow write: if isAdmin();
    }

    // Server-side only (Admin SDK bypasses rules)
    match /whatsapp_queue/{doc} {
      allow read: if isAdmin();
      allow write: if false;
    }

    match /whatsapp_alert_history/{doc} {
      allow read: if isAdmin();
      allow write: if false;
    }

    match /email_daily_stats/{doc} {
      allow read: if isAdmin();
      allow write: if false;
    }

    // Collection group query for predictions
    match /{path=**}/predictions/{predictionId} {
      allow read: if isSignedIn();
    }
  }
}
```

## 20.2 Rate Limiting Summary

| Limit | Value | Purpose |
|-------|-------|---------|
| Email Global | 30/day | Prevent spam |
| Email Per-Address | 5/day | Prevent harassment |
| WhatsApp | 5-10 sec between | Avoid bans |
| Failed Logins | 5 attempts | Brute force protection |

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

## 21.3 Git Workflow

```
Branches:
  main     → Production (auto-deploys)
  develop  → Integration (no deploy)
  feature/ → Feature work (no deploy)

Rules:
  - Never commit directly to main
  - Always branch from develop
  - Squash merge to main
  - Bump version before merge
```

---

# 22. API Reference

## 22.1 Prediction API

### POST /api/submit-prediction

Submits a race prediction with server-side lockout enforcement.

**Request:**
```typescript
interface PredictionRequest {
  userId: string;
  teamId: string;
  teamName: string;
  raceId: string;
  raceName: string;
  predictions: string[];  // Array of 6 driver IDs
}
```

**Response:**
```typescript
{ success: true }
// or
{ success: false, error: string, correlationId?: string }
```

**Lockout:** Returns 403 if qualifying has started.

## 22.2 Email APIs

### POST /api/send-welcome-email

**Request:** `{ toEmail, teamName, pin }`

### POST /api/send-hot-news-email

**Request:** `{ content, updatedBy, updatedByEmail }`

### POST /api/send-results-email

**Request:** `{ raceId, results }`

### POST /api/email-queue

**Request:** `{ action: 'process' }`

## 22.3 WhatsApp Worker APIs

### GET /health

```json
{ "status": "ok", "whatsapp": { "connected": true } }
```

### GET /status

```json
{
  "whatsapp": {
    "ready": true,
    "qrCode": null,
    "storage": "azure"
  }
}
```

### GET /qr

Returns QR code data for WhatsApp authentication (during initial setup).

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

---

# Appendix A: File Structure

```
E:\GoogleDrive\Papers\03-PrixSix\03.Current\
├── app/                           # Next.js application
│   ├── src/
│   │   ├── app/                   # App Router pages
│   │   │   ├── (app)/             # Authenticated pages
│   │   │   │   ├── admin/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── predictions/
│   │   │   │   ├── standings/
│   │   │   │   ├── results/
│   │   │   │   ├── teams/
│   │   │   │   ├── submissions/
│   │   │   │   ├── schedule/
│   │   │   │   ├── rules/
│   │   │   │   ├── profile/
│   │   │   │   └── about/
│   │   │   ├── (auth)/
│   │   │   │   ├── login/
│   │   │   │   ├── signup/
│   │   │   │   └── forgot-pin/
│   │   │   └── api/
│   │   │       ├── submit-prediction/
│   │   │       ├── send-welcome-email/
│   │   │       ├── send-results-email/
│   │   │       ├── send-hot-news-email/
│   │   │       └── email-queue/
│   │   ├── ai/                    # Genkit AI flows
│   │   │   ├── genkit.ts
│   │   │   ├── dev.ts
│   │   │   └── flows/
│   │   │       ├── team-name-generator.ts
│   │   │       ├── hot-news-feed.ts
│   │   │       └── dynamic-driver-updates.ts
│   │   ├── components/
│   │   │   ├── ui/                # shadcn/ui components
│   │   │   ├── layout/
│   │   │   │   └── AppSidebar.tsx
│   │   │   ├── admin/             # Admin tab components
│   │   │   │   ├── SiteFunctionsManager.tsx
│   │   │   │   ├── TeamManager.tsx
│   │   │   │   ├── ResultsManager.tsx
│   │   │   │   ├── ScoringManager.tsx
│   │   │   │   ├── HotNewsManager.tsx
│   │   │   │   ├── OnlineUsersManager.tsx
│   │   │   │   ├── EmailLogManager.tsx
│   │   │   │   ├── AuditManager.tsx
│   │   │   │   ├── WhatsAppManager.tsx
│   │   │   │   └── ConsistencyChecker.tsx
│   │   │   └── FirebaseErrorListener.tsx
│   │   ├── contexts/
│   │   │   └── session-context.tsx
│   │   ├── firebase/
│   │   │   ├── index.ts
│   │   │   ├── config.ts
│   │   │   ├── provider.tsx
│   │   │   ├── client-provider.tsx
│   │   │   ├── firestore/
│   │   │   │   ├── use-collection.ts
│   │   │   │   ├── use-doc.ts
│   │   │   │   └── settings.ts
│   │   │   ├── non-blocking-updates.ts
│   │   │   ├── non-blocking-login.ts
│   │   │   ├── errors.ts
│   │   │   └── error-emitter.ts
│   │   └── lib/
│   │       ├── audit.ts
│   │       ├── consistency.ts
│   │       ├── data.ts            # Drivers, Races
│   │       ├── email.ts
│   │       ├── email-tracking.ts
│   │       ├── firebase-admin.ts
│   │       ├── scoring.ts
│   │       └── version.ts
│   ├── docs/
│   │   └── backend.json           # HLD/LLD for About page
│   ├── scripts/                   # Utility scripts
│   │   ├── check-data-consistency.ts
│   │   ├── fix-australian-gp-scores.ts
│   │   ├── get-cc-log.ts
│   │   └── ...
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.scripts.json
│   ├── firebase.json
│   ├── firestore.rules
│   └── .env.example
├── whatsapp-worker/
│   ├── src/
│   │   ├── index.ts
│   │   ├── whatsapp-client.ts
│   │   ├── queue-processor.ts
│   │   ├── azure-store.ts
│   │   └── firebase-config.ts
│   ├── Dockerfile
│   ├── package.json
│   └── .env.example
├── docs/
│   ├── PRIX_SIX_HLD_COMPLETE_V3.md  # This document
│   ├── PRIX_SIX_HLD_COMPLETE_V2.md
│   └── PRIX_SIX_ER_DIAGRAM.md
├── claude-sync.js
├── service-account.json           # (Not in git)
├── CLAUDE.md
└── CHANGELOG.md
```

---

# Appendix B: Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.10.0 | January 2026 | WhatsApp Alert Control Panel, 11 alert types |
| 1.9.x | January 2026 | WhatsApp integration, Azure deployment |
| 1.8.x | December 2025 | Hot News with Gemini AI |
| 1.7.x | December 2025 | Email notifications via Microsoft Graph |
| 1.6.x | November 2025 | Audit logging system |
| 1.5.x | November 2025 | Consistency checker |
| 1.4.x | October 2025 | Admin dashboard expansion |
| 1.3.x | September 2025 | Scoring system refinements |
| 1.2.x | August 2025 | User registration and profiles |
| 1.1.x | July 2025 | Prediction system |
| 1.0.0 | June 2025 | Initial release |

---

# Appendix C: UI Components (shadcn/ui)

The application uses the following shadcn/ui components:

| Component | Usage |
|-----------|-------|
| Accordion | Collapsible sections |
| Alert Dialog | Confirmations |
| Avatar | User avatars |
| Button | All buttons |
| Card | Content containers |
| Carousel | Image carousels |
| Checkbox | Form checkboxes |
| Collapsible | Expandable content |
| Dialog | Modal dialogs |
| Dropdown Menu | Context menus |
| Input | Text inputs |
| Input OTP | PIN entry |
| Label | Form labels |
| Menubar | Navigation menus |
| Popover | Tooltips, popovers |
| Progress | Progress bars |
| Radio Group | Radio options |
| Scroll Area | Scrollable containers |
| Select | Dropdowns |
| Separator | Visual dividers |
| Sidebar | Main navigation |
| Skeleton | Loading states |
| Slider | Range inputs |
| Switch | Toggle switches |
| Table | Data tables |
| Tabs | Tab interfaces |
| Toast | Notifications |
| Toaster | Toast container |
| Tooltip | Hover tooltips |

---

# Appendix D: Utility Scripts

Located in `app/scripts/`:

| Script | Purpose |
|--------|---------|
| `check-data-consistency.ts` | Validate driver/race/prediction IDs |
| `verify-admin.ts` | Verify admin account status |
| `seed-big-shakedown.ts` | Generate test data |
| `fix-australian-gp-scores.ts` | Correct scoring issues |
| `get-cc-log.ts` | Retrieve consistency checker logs |
| `delete-all-scores.ts` | Purge all scores (destructive) |

**Running scripts:**
```bash
npm run seed:big-shakedown
npm run verify:admin
# Or manually:
npx ts-node --project tsconfig.scripts.json scripts/script-name.ts
```

---

# Appendix E: Architectural Patterns

## E.1 Real-time Reactivity
All data accessed via `useCollection`/`useDoc` with auto-subscriptions. Components automatically re-render when Firestore data changes.

## E.2 Error as First-Class Citizen
Global event emitter for permission errors with LLM-friendly formatting. Errors are structured to mirror Firestore security rules context for debugging.

## E.3 Non-Blocking UX
Authentication and Firestore updates fire without blocking render. State changes are handled by dedicated listeners (`onAuthStateChanged`, `onSnapshot`).

## E.4 Admin Session Isolation
Single User Mode prevents multi-user confusion during admin operations. All non-designated sessions are purged on activation.

## E.5 Complete Audit Trail
Every significant user action tracked with correlation IDs for debugging. Session-scoped correlation enables tracing across multiple actions.

## E.6 Type-Safe Events
Generic event emitter ensures event name and payload type alignment at compile time.

## E.7 Session-Based Tracking
GUID-based sessions for multi-tab/device user management. Sessions are tracked in presence collection as an array.

## E.8 Memoization Enforcement
Hooks validate that inputs are memoized to prevent infinite re-renders. Console warnings issued if `__memo` flag is missing.

## E.9 Dual Data Storage
Predictions stored in two formats for different query patterns:
- Subcollection for user's own data (array format)
- Flat collection for admin queries (object format)

## E.10 Client-Side Calculation
Score calculation happens in the browser for immediate feedback. Results written to Firestore after calculation completes.

---

# Appendix F: Type Definitions

## F.1 Core Types

```typescript
// User
interface User {
  id: string;
  email: string;
  teamName: string;
  secondaryTeamName?: string;
  isAdmin: boolean;
  mustChangePin?: boolean;
  badLoginAttempts?: number;
  emailPreferences?: EmailPreferences;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// Driver
interface Driver {
  id: string;
  name: string;
  number: number;
  team: string;
  imageId: string;
}

// Race
interface Race {
  name: string;
  location: string;
  qualifyingTime: string;
  raceTime: string;
  sprintTime?: string;
  hasSprint: boolean;
  results?: string[];
}

// Prediction (Subcollection)
interface Prediction {
  id: string;
  userId: string;
  raceId: string;
  predictions: string[];
  submissionTimestamp: Timestamp;
}

// Prediction Submission (Flat)
interface PredictionSubmission {
  userId: string;
  teamName: string;
  raceId: string;
  predictions: {
    P1: string;
    P2: string;
    P3: string;
    P4: string;
    P5: string;
    P6: string;
  };
  submittedAt: Timestamp;
}

// Score
interface Score {
  id: string;
  userId: string;
  raceId: string;
  totalPoints: number;
  breakdown: string;
  calculatedAt?: Timestamp;
}

// Presence
interface Presence {
  id: string;
  online: boolean;
  sessions: string[];
}
```

## F.2 Context Types

```typescript
// Firebase Context
interface FirebaseContextState {
  firebaseApp: FirebaseApp | null;
  firestore: Firestore | null;
  authService: Auth | null;
  user: User | null;
  firebaseUser: FirebaseAuthUser | null;
  isUserLoading: boolean;
  userError: Error | null;
  login(email: string, pin: string): Promise<AuthResult>;
  signup(email: string, teamName: string, pin?: string): Promise<AuthResult>;
  logout(): void;
  updateUser(userId: string, data: Partial<User>): Promise<AuthResult>;
  deleteUser(userId: string): Promise<AuthResult>;
  addSecondaryTeam(teamName: string): Promise<AuthResult>;
  resetPin(email: string): Promise<AuthResult>;
  changePin(email: string, newPin: string): Promise<AuthResult>;
}

// Session Context
interface SessionContextState {
  sessionId: string | null;
}

// Auth Result
interface AuthResult {
  success: boolean;
  error?: string;
  userId?: string;
}
```

## F.3 Hook Return Types

```typescript
// useCollection
interface UseCollectionResult<T> {
  data: WithId<T>[] | null;
  isLoading: boolean;
  error: FirestoreError | Error | null;
}

// useDoc
interface UseDocResult<T> {
  data: WithId<T> | null;
  isLoading: boolean;
  error: FirestoreError | Error | null;
}

// WithId helper
type WithId<T> = T & { id: string };
```

---

**End of Document**

*Prix Six - Comprehensive High-Level Design Document*
*Version 3.0 (Enhanced Technical Reference) - 21 January 2026*
*Total Sections: 23 + 6 Appendices*
*Enhancements: Session management, error handling architecture, React patterns, AI/Genkit flows, type definitions*
