# Prix Six - High-Level Design Document

**Document Version:** 1.0
**Application Version:** 1.10.0
**Last Updated:** January 2026
**Author:** Auto-generated from codebase analysis

---

## 1. Executive Summary

Prix Six is a cloud-native Fantasy Formula 1 league application serving approximately 20 players who compete via a WhatsApp group. Built on Firebase infrastructure with a Next.js frontend, the platform enables users to predict the top 6 finishers for each F1 race, with automated scoring calculated against official results. The architecture prioritises real-time updates, multi-channel notifications (email and WhatsApp), and administrative oversight through comprehensive audit logging. The system employs a NoSQL data model optimised for the league's prediction-to-scoring workflow, with security enforced through Firestore rules and role-based access control. External integrations include Microsoft Graph for transactional email, an Azure-containerised WhatsApp worker for group messaging, and Google Genkit for AI-powered content generation.

---

## 2. System Architecture Overview

### 2.1 Architecture Diagram (Text Description)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │   Web Browser   │    │  Mobile Browser │    │  WhatsApp Group │         │
│  │   (Next.js)     │    │   (Responsive)  │    │   (Recipients)  │         │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘         │
│           │                      │                      │                   │
│           └──────────────────────┼──────────────────────┘                   │
│                                  ▼                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                           APPLICATION LAYER                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    NEXT.JS APPLICATION (App Router)                  │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │   │
│  │  │  React Pages │  │ API Routes   │  │  Server      │              │   │
│  │  │  & Components│  │ /api/*       │  │  Components  │              │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                  │                                          │
│  ┌──────────────────┐   ┌────────┴────────┐   ┌──────────────────┐        │
│  │ WhatsApp Worker  │   │ Firebase Client │   │ Genkit AI Server │        │
│  │ (Docker/Azure)   │   │ SDK             │   │ (Gemini 2.5)     │        │
│  └────────┬─────────┘   └────────┬────────┘   └────────┬─────────┘        │
│           │                      │                      │                   │
├───────────┼──────────────────────┼──────────────────────┼───────────────────┤
│           │              DATA LAYER                     │                   │
├───────────┼──────────────────────┼──────────────────────┼───────────────────┤
│           │                      ▼                      │                   │
│           │  ┌─────────────────────────────────────────────────────────┐   │
│           │  │                    FIREBASE                              │   │
│           │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │   │
│           │  │  │  Firestore  │  │    Auth     │  │   Hosting   │     │   │
│           │  │  │  (NoSQL DB) │  │ (PIN-based) │  │ (App Host)  │     │   │
│           │  │  └─────────────┘  └─────────────┘  └─────────────┘     │   │
│           │  └─────────────────────────────────────────────────────────┘   │
│           │                                                                 │
├───────────┼─────────────────────────────────────────────────────────────────┤
│           │              EXTERNAL SERVICES                                  │
├───────────┼─────────────────────────────────────────────────────────────────┤
│           │                                                                 │
│           ▼                      ┌─────────────────┐                       │
│  ┌─────────────────┐            │  Microsoft 365   │                       │
│  │  WhatsApp Web   │            │  (Graph API)     │                       │
│  │  (via puppeteer)│            │  Email Sending   │                       │
│  └─────────────────┘            └─────────────────┘                       │
│                                                                             │
│  ┌─────────────────┐            ┌─────────────────┐                       │
│  │  Azure Blob     │            │  Google AI      │                       │
│  │  Storage        │            │  (Gemini)       │                       │
│  │  (Session Store)│            │  Content Gen    │                       │
│  └─────────────────┘            └─────────────────┘                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow Summary

1. **User Authentication Flow**
   - User enters email + 6-digit PIN → Next.js API validates against Firestore → Session token issued → Client receives user context

2. **Prediction Submission Flow**
   - User selects 6 drivers → API route validates lock time → Writes to `/users/{uid}/predictions` AND `/prediction_submissions` → Real-time listeners update UI

3. **Scoring Calculation Flow**
   - Admin enters race results → Triggers score calculation → Reads all predictions for race → Applies scoring algorithm → Writes to `/scores` → Standings update automatically

4. **Notification Flow**
   - Event triggers (results entered, hot news updated) → API route queues message → Email: Microsoft Graph sends → WhatsApp: Queue processor sends via worker

---

## 3. Module Breakdown

### 3.1 User Management Module

**Purpose:** Manages user identity, authentication, preferences, and real-time presence tracking.

**Key Components:**
| File | Responsibility |
|------|----------------|
| `firebase/provider.tsx` | Firebase context, auth state, user CRUD operations |
| `(auth)/login/page.tsx` | PIN-based authentication UI |
| `(auth)/signup/page.tsx` | New user registration |
| `(auth)/forgot-pin/page.tsx` | PIN reset flow |
| `(app)/profile/page.tsx` | User settings and email preferences |
| `lib/audit.ts` | Audit event logging |

**Data Interactions:**
- **Read:** `/users/{userId}` for auth validation and profile display
- **Write:** `/users/{userId}` for profile updates, PIN changes
- **Write:** `/presence/{userId}` for online status tracking
- **Write:** `/audit_logs` for action tracking

**Key Interfaces:**
```typescript
interface User {
  id: string;           // Firebase Auth UID
  email: string;        // Unique email
  teamName: string;     // Primary team name
  isAdmin: boolean;     // Admin privileges
  secondaryTeamName?: string;
  emailPreferences?: EmailPreferences;
}
```

---

### 3.2 Race Operations Module

**Purpose:** Manages race schedule, driver data, and official race results entry.

**Key Components:**
| File | Responsibility |
|------|----------------|
| `lib/data.ts` | Static F1 drivers (24) and race calendar (24 races) |
| `admin/_components/ResultsManager.tsx` | Admin UI for entering P1-P6 results |
| `(app)/schedule/page.tsx` | Race calendar display |
| `(app)/results/page.tsx` | Results viewing |

**Data Interactions:**
- **Read:** Static `F1Drivers[]` and `RaceSchedule[]` arrays (in-code, not Firestore)
- **Read:** `/race_results` for displaying entered results
- **Write:** `/race_results/{raceId}` when admin enters results
- **Triggers:** Score calculation on result entry

**Static Data Structure:**
```typescript
interface Driver {
  id: string;      // e.g., "verstappen"
  name: string;    // e.g., "Max Verstappen"
  number: number;  // e.g., 1
  team: string;    // e.g., "Red Bull Racing"
  imageId: string; // Image reference
}

interface Race {
  name: string;           // "Australian Grand Prix"
  qualifyingTime: string; // ISO UTC - prediction lock
  raceTime: string;       // ISO UTC - race start
  location: string;       // "Melbourne, Australia"
  hasSprint: boolean;     // Sprint weekend flag
}
```

---

### 3.3 Prediction System Module

**Purpose:** Enables users to submit and manage their 6-driver predictions for each race.

**Key Components:**
| File | Responsibility |
|------|----------------|
| `(app)/predictions/page.tsx` | Prediction submission UI |
| `api/submit-prediction/route.ts` | Server-side validation and storage |
| `(app)/submissions/page.tsx` | View submission history |
| `admin/_components/ConsistencyChecker.tsx` | Data integrity validation |

**Data Interactions:**
- **Read:** `/users/{userId}/predictions` for user's existing predictions
- **Read:** `/prediction_submissions` for admin views and consistency checks
- **Write:** `/users/{userId}/predictions/{predictionId}` on submission
- **Write:** `/prediction_submissions` as denormalised copy for admin queries

**Dual Storage Pattern:**
The system stores predictions in two locations:
1. **Subcollection** (`/users/{uid}/predictions`): Strong ownership, user-scoped queries
2. **Root collection** (`/prediction_submissions`): Efficient cross-user admin queries

**Lock Time Enforcement:**
Predictions lock at qualifying time (typically Saturday). Server-side validation prevents late submissions.

---

### 3.4 Scoring System Module

**Purpose:** Calculates and stores points based on prediction accuracy vs actual race results.

**Key Components:**
| File | Responsibility |
|------|----------------|
| `lib/scoring.ts` | Core scoring algorithm and calculation functions |
| `lib/consistency.ts` | Score validation and integrity checking |
| `(app)/standings/page.tsx` | League standings display |
| `admin/_components/ScoringManager.tsx` | Admin scoring controls |

**Scoring Algorithm (Prix Six Rules):**
```
Per Driver:
  +5 points: Exact position match
  +3 points: Driver in top 6 but wrong position
  +0 points: Driver not in top 6

Bonus:
  +10 points: All 6 predicted drivers appear in top 6

Maximum: 40 points per race (6 × 5 + 10 bonus)
```

**Data Interactions:**
- **Read:** `/users/{userId}/predictions` via collectionGroup query
- **Read:** `/prediction_submissions` as fallback/cross-check
- **Read:** `/race_results/{raceId}` for actual positions
- **Write:** `/scores/{raceId}_{userId}` with calculated points

**Key Function:**
```typescript
function calculateScoresForRace(
  predictions: Prediction[],
  result: RaceResult,
  users: User[]
): ScoreWithTeam[]
```

---

### 3.5 Notification System Module

**Purpose:** Multi-channel notifications via email (Microsoft Graph) and WhatsApp (custom worker).

**Key Components:**
| File | Responsibility |
|------|----------------|
| `lib/email.ts` | Email composition and Microsoft Graph integration |
| `lib/email-tracking.ts` | Send rate limiting and daily stats |
| `api/send-welcome-email/route.ts` | Onboarding emails |
| `api/send-results-email/route.ts` | Post-race score emails |
| `api/send-hot-news-email/route.ts` | Breaking news emails |
| `admin/_components/WhatsAppManager.tsx` | WhatsApp admin panel |
| `firebase/firestore/settings.ts` | Alert configuration storage |

**Email Flow:**
```
Trigger Event → API Route → Compose HTML → Microsoft Graph → Recipient
                    ↓
              email_logs (tracking)
                    ↓
              email_daily_stats (rate limiting)
```

**WhatsApp Flow:**
```
Admin Panel / Automated Trigger
           ↓
    whatsapp_queue (Firestore)
           ↓
    Queue Processor (Docker Worker)
           ↓
    whatsapp-web.js → WhatsApp Web
           ↓
    whatsapp_alert_history (audit)
```

**Data Interactions:**
- **Write:** `/email_queue` for pending emails
- **Write:** `/email_logs` for sent email tracking
- **Write:** `/email_daily_stats/{date}` for rate limiting
- **Write:** `/whatsapp_queue` for pending messages
- **Write:** `/whatsapp_alert_history` for sent message audit
- **Read/Write:** `/admin_configuration/whatsapp_alerts` for settings

---

### 3.6 Admin & System Module

**Purpose:** Administrative functions, feature toggles, audit logging, and system monitoring.

**Key Components:**
| File | Responsibility |
|------|----------------|
| `(app)/admin/page.tsx` | Admin panel with tabbed interface |
| `admin/_components/SiteFunctionsManager.tsx` | Feature toggles |
| `admin/_components/TeamManager.tsx` | User management |
| `admin/_components/AuditLogViewer.tsx` | Audit trail UI |
| `admin/_components/ConsistencyChecker.tsx` | Data validation |
| `admin/_components/EmailLogManager.tsx` | Email history |
| `admin/_components/OnlineUsersManager.tsx` | Real-time presence |

**Admin Panel Tabs:**
1. **Functions** - Site-wide feature toggles
2. **Teams** - User account management
3. **Enter Results** - Race result entry
4. **Scoring** - Score calculation controls
5. **Hot News** - AI-generated content management
6. **Online** - Real-time user presence
7. **Email Logs** - Sent email history
8. **Audit** - Action audit trail
9. **WhatsApp** - Alert configuration and manual messaging
10. **CC** - Consistency Checker

**Data Interactions:**
- **Read/Write:** `/app-settings/hot-news` for news content
- **Read/Write:** `/admin_configuration/whatsapp_alerts` for alert settings
- **Read:** `/audit_logs` for audit trail (admin only)
- **Read:** `/error_logs` for error tracking (admin only)
- **Write:** `/coordination/claude-state` for development coordination

---

## 4. Security Model

### 4.1 Authentication

**Method:** Custom PIN-based authentication (6-digit numeric PIN)

**Flow:**
1. User enters email + PIN
2. Server validates against `/users/{email}` document
3. On success, Firebase custom token issued
4. Client uses token for subsequent requests

**Security Measures:**
- `badLoginAttempts` counter for brute-force protection
- `mustChangePin` flag for forced resets
- Server-side PIN validation (not client-side)

### 4.2 Firestore Security Rules

**Access Control Model:**
```
┌─────────────────┬───────────────────────────────────────────────────────┐
│ Collection      │ Access Control                                        │
├─────────────────┼───────────────────────────────────────────────────────┤
│ users           │ Read/Write: Owner or Admin                            │
│ predictions     │ Read: Any signed-in | Write: Owner or Admin           │
│ race_results    │ Read: Public | Write: Admin only                      │
│ scores          │ Read: Public | Write: Admin only                      │
│ audit_logs      │ Read: Admin | Write: User for own actions             │
│ error_logs      │ Read: Admin | Write: Signed-in (create only)          │
│ email_*         │ Read: Admin | Write: Server-side only                 │
│ whatsapp_*      │ Read: Admin | Write: Server-side only                 │
│ app-settings    │ Read: Public | Write: Admin only                      │
│ admin_config    │ Read/Write: Admin only                                │
└─────────────────┴───────────────────────────────────────────────────────┘
```

**Helper Functions:**
```javascript
function isSignedIn() { return request.auth != null; }
function isOwner(userId) { return request.auth.uid == userId; }
function isAdmin() {
  return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.isAdmin == true;
}
```

### 4.3 Service Account Usage

**Admin SDK Contexts:**
| Context | Credential Type | Purpose |
|---------|-----------------|---------|
| API Routes | Service Account | Server-side DB access, bypasses rules |
| WhatsApp Worker | Service Account | Queue processing, status updates |
| Cloud Functions | Service Account | Automated tasks |

**Protected Accounts:**
- `aaron@garcia.ltd` - Primary admin
- `aaron.garcia@hotmail.co.uk` - Secondary admin account

---

## 5. Scalability & Performance

### 5.1 Current Scale

- **Users:** ~20 active players
- **Races:** 24 per season
- **Predictions:** ~480 per season (20 users × 24 races)
- **Scores:** ~480 per season

### 5.2 Scaling Considerations

**Firestore Optimisations:**
1. **Denormalisation:** `prediction_submissions` mirrors subcollection for efficient admin queries
2. **Composite Keys:** Scores use `{raceId}_{userId}` preventing duplicates
3. **Index Configuration:** Custom indexes defined in `firestore.indexes.json`

**Real-time Listeners:**
- Presence tracking uses individual document listeners
- Queue processing uses Firestore onSnapshot for real-time updates

**WhatsApp Worker Architecture:**
- Containerised Node.js service (Docker)
- Azure Blob Storage for session persistence
- Rate limiting (5-10 second delays between messages)
- Retry logic with max 3 attempts

### 5.3 Future Scaling Path

If user base grows significantly:
1. **Caching:** Add Redis/Memcached for standings computation
2. **Batch Processing:** Move score calculation to Cloud Functions
3. **CDN:** Leverage Firebase Hosting CDN for static assets
4. **Sharding:** Partition predictions by season if history grows

---

## 6. External Integration Details

### 6.1 Microsoft Graph (Email)

**Authentication:** OAuth 2.0 Client Credentials Flow
```
Azure AD Tenant → Client ID + Secret → Access Token → Graph API
```

**Endpoint:** `POST /users/{sender}/sendMail`
**Sender:** aaron@garcia.ltd (configurable)

**Email Types:**
- Welcome (onboarding with PIN)
- Results (post-race scores)
- Hot News (AI-generated content)

### 6.2 WhatsApp Web (whatsapp-web.js)

**Architecture:**
```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Admin Panel     │────▶│ Firestore Queue │────▶│ Docker Worker   │
│ (Web UI)        │     │ whatsapp_queue  │     │ (Azure ACI)     │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
                                               ┌─────────────────┐
                                               │ WhatsApp Web    │
                                               │ (Puppeteer)     │
                                               └─────────────────┘
```

**Session Persistence:**
- Development: Local filesystem (`.wwebjs_auth/`)
- Production: Azure Blob Storage (`AzureBlobStore` class)

**Risk Note:** whatsapp-web.js is unofficial and may violate WhatsApp ToS. Acknowledged and accepted for league use.

### 6.3 Google Genkit (AI)

**Model:** Gemini 2.5 Flash
**Use Cases:**
- Hot news content generation
- Team name suggestions
- Driver performance summaries

---

## 7. Deployment Architecture

### 7.1 Firebase App Hosting

**Configuration:**
```json
{
  "apphosting": {
    "backendId": "prixsix",
    "rootDir": "app",
    "region": "europe-west4"
  }
}
```

**Deployment Trigger:** Push to `main` branch
**Build Time:** ~3-5 minutes
**URL:** https://prixsix--studio-6033436327-281b1.europe-west4.hosted.app

### 7.2 WhatsApp Worker (Azure Container Instance)

**Deployment Script:** `deploy-whatsapp.ps1`
**Container URL:** https://prixsix-whatsapp.uksouth.azurecontainer.io:3000

**Environment Variables:**
- `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_STORAGE_CONTAINER`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `PORT` (default: 3000)

### 7.3 Version Management

**Semantic Versioning:** MAJOR.MINOR.PATCH

**Current Version:** 1.10.0

**Changelog:** Maintained in `CHANGELOG.md`

---

## 8. Error Handling & Observability

### 8.1 Error Correlation

Every error generates a unique correlation ID:
```typescript
const correlationId = `err_${Date.now()}_${randomString(6)}`;
```

**Error Log Structure:**
```typescript
{
  correlationId: string;
  error: string;
  stack: string;
  context: {
    route?: string;
    action?: string;
    userId?: string;
    requestData?: object;
    userAgent?: string;
  };
  timestamp: Timestamp;
}
```

### 8.2 Audit Logging

All significant actions logged to `/audit_logs`:
- User authentication
- Prediction submissions
- Result entries
- Settings changes
- Email sends
- WhatsApp messages

**Audit Entry Structure:**
```typescript
{
  userId: string;
  action: string;      // e.g., "SUBMIT_PREDICTION"
  details: object;     // Action-specific metadata
  correlationId: string;
  timestamp: Timestamp;
}
```

### 8.3 Consistency Checker

Automated validation covering:
- User data integrity
- Driver reference validity
- Race schedule consistency
- Prediction format validation
- Result data validation
- Score calculation verification
- Standings accuracy

---

## 9. Appendices

### A. Technology Stack Summary

| Layer | Technology | Version |
|-------|------------|---------|
| Frontend | Next.js | 15.5.9 |
| UI Framework | React | 19.2.1 |
| Styling | Tailwind CSS | 4.1.4 |
| Components | Radix UI | Various |
| Backend | Firebase | 11.9.1 |
| Database | Firestore | - |
| Auth | Firebase Auth (Custom) | - |
| Email | Microsoft Graph | 3.0.7 |
| WhatsApp | whatsapp-web.js | 1.26.0 |
| AI | Google Genkit | 1.20.0 |
| Containerisation | Docker | - |
| Cloud | Firebase Hosting, Azure ACI | - |

### B. File Structure Overview

```
/app                          # Next.js application
  /src
    /app                      # App Router pages
      /(app)                  # Protected routes
      /(auth)                 # Auth pages
      /api                    # API routes
    /components               # React components
    /contexts                 # React contexts
    /firebase                 # Firebase setup
    /lib                      # Utilities
    /ai                       # Genkit flows
/whatsapp-worker              # Docker service
  /src                        # Worker source
/scripts                      # Admin utilities
/docs                         # Documentation
firebase.json                 # Firebase config
firestore.rules               # Security rules
CLAUDE.md                     # Development guide
```

### C. Key Firestore Indexes

Defined in `firestore.indexes.json`:
- `audit_logs` - timestamp descending
- `scores` - raceId + userId composite
- `predictions` - raceId for collectionGroup queries

---

*Document generated from Prix Six codebase analysis. For questions, contact the development team.*
