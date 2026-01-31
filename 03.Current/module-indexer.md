# MODULE-INDEXER.md — Master Directive for Code Registry & Error Traceability

> **Purpose**: Instructs Claude Code how to build and enforce an error tracing system where every error contains guaranteed-correct metadata from a single master registry.
> 
> **Version**: 2.0 | **Updated**: 2026-01-31
>
> **Read this entire file before making any changes to error handling or Code.json.**

---

## 🎯 THE CORE PROBLEM

When an error occurs, you need instant answers to **four questions**:

| # | Question | What You Need |
|---|----------|---------------|
| 1 | **Where did it fail?** | File path, function name, correlation ID |
| 2 | **What was it trying to do?** | Business context, not just stack trace |
| 3 | **What are the known failure modes?** | Pre-documented gotchas, recovery steps |
| 4 | **Who/what triggered it?** | Call chain, upstream dependencies |

**Current state**: Grep the codebase, walk through files, guess at connections.

**Target state**: Instant lookup → exact file, function, context, and fix.

---

## 🎯 THE SOLUTION

**Code.json** (master registry):
- Maps every code block to a GUID
- Maps every GUID to its file location  
- Maps every error code to its throwing GUID
- Documents failure modes and recovery steps
- Tracks call chain dependencies

**error-registry.ts** (generated):
- Typed constants for every error
- Guarantees logs have correct metadata
- Eliminates hardcoded error codes

---

## 📋 FOUR QUESTIONS — ANSWERED BY DESIGN

Every error logged automatically answers all four:

```json
{
  "code": "PX-7004",
  "guid": "BACKUP_FUNCTIONS-026",
  "module": "BACKUP_FUNCTIONS",
  "file": "functions/src/index.ts",
  "functionName": "runRecoveryTest",
  "message": "Recovery smoke test failed",
  "severity": "critical",
  "recovery": "Check lastBackupPath exists in backup_status/latest",
  "failureModes": ["No backup exists yet", "Missing IAM role", "Import timeout"],
  "correlationId": "smoke_abc123_x7f",
  "context": { "importPath": "gs://prix6-backups/2026-01-31" },
  "calledBy": ["BACKUP_FUNCTIONS-020"],
  "calls": ["BACKUP_FUNCTIONS-005"]
}
```

| Question | Answered By |
|----------|-------------|
| 1. Where? | `file` + `functionName` + `correlationId` |
| 2. What? | `message` + `context` |
| 3. Known failures? | `recovery` + `failureModes` |
| 4. Who triggered? | `calledBy` + `calls` |

---

## 📁 FILE STRUCTURE

```
src/lib/
├── error-registry.ts      # AUTO-GENERATED — never edit
├── traced-error.ts        # Error creation utilities
src/types/
└── errors.ts              # TypeScript interfaces
docs/
├── Code.json              # Master registry
├── code-index.json        # Lightweight lookup index
scripts/
└── generate-error-registry.ts
```

---

## 📋 PHASE 1: CODE.JSON SCHEMA (v4)

```json
{
  "guid": "BACKUP_FUNCTIONS-026",
  "version": 4,
  "logic_category": "RECOVERY",
  "description": "Error handler for runRecoveryTest",
  "dependencies": ["BACKUP_FUNCTIONS-005"],
  
  "location": {
    "filePath": "functions/src/index.ts",
    "functionName": "runRecoveryTest"
  },
  
  "errorProfile": {
    "throws": ["PX-7004"],
    "handles": ["PX-7002", "PX-7003"],
    "emits": {
      "PX-7004": {
        "key": "SMOKE_TEST_FAILED",
        "message": "Recovery smoke test failed",
        "severity": "critical",
        "recovery": "Check lastBackupPath exists. Verify IAM roles.",
        "failureModes": [
          "No backup exists yet (lastBackupPath is null)",
          "Recovery project missing IAM role",
          "Firestore import timeout (>5 min)"
        ]
      }
    }
  },
  
  "callChain": {
    "calledBy": ["BACKUP_FUNCTIONS-020"],
    "calls": ["BACKUP_FUNCTIONS-005"]
  }
}
```

### Field Reference

| Field | Required | Answers | Purpose |
|-------|----------|---------|---------|
| `location.filePath` | YES | #1 | Durable file pointer |
| `location.functionName` | If applicable | #1 | Ctrl+F target |
| `errorProfile.emits[].message` | YES | #2 | Human-readable message |
| `errorProfile.emits[].recovery` | YES | #3 | Fix instructions |
| `errorProfile.emits[].failureModes` | YES | #3 | Pre-documented gotchas |
| `callChain.calledBy` | If applicable | #4 | Upstream GUIDs |
| `callChain.calls` | If applicable | #4 | Downstream GUIDs |

---

## 📋 PHASE 2: FILE PATH MAPPING

| GUID Prefix | Path Pattern |
|-------------|--------------|
| `ADMIN_XXX` | `src/components/admin/{Name}.tsx` |
| `API_XXX` | `src/app/api/{route}/route.ts` |
| `LIB_XXX` | `src/lib/{name}.ts` |
| `PAGE_XXX` | `src/app/{route}/page.tsx` |
| `COMPONENT_XXX` | `src/components/{Name}.tsx` |
| `FIREBASE_PROVIDER` | `src/contexts/FirebaseProvider.tsx` |
| `BACKUP_FUNCTIONS` | `functions/src/index.ts` |
| `BACKUP_DASHBOARD` | `src/components/admin/BackupHealthDashboard.tsx` |

---

## 📋 PHASE 3: LOOKUP INDEX

### File: `docs/code-index.json`

**Claude Code consults this FIRST** — instant lookup without parsing 901 GUIDs.

```json
{
  "byErrorCode": {
    "PX-7004": {
      "guid": "BACKUP_FUNCTIONS-026",
      "file": "functions/src/index.ts",
      "function": "runRecoveryTest",
      "message": "Recovery smoke test failed",
      "recovery": "Check lastBackupPath exists..."
    }
  },
  
  "byTopic": {
    "smoke": ["BACKUP_FUNCTIONS-020", "...", "BACKUP_FUNCTIONS-026"],
    "login": ["API_AUTH_LOGIN-000", "..."],
    "scoring": ["API_CALCULATE_SCORES-000", "LIB_SCORING-000", "..."]
  },
  
  "byModule": {
    "BACKUP_FUNCTIONS": {
      "files": ["functions/src/index.ts"],
      "errorCodes": ["PX-7001", "PX-7002", "PX-7003", "PX-7004"]
    }
  },
  
  "byFile": {
    "functions/src/index.ts": {
      "modules": ["BACKUP_FUNCTIONS"],
      "errorCodes": ["PX-7001", "PX-7002", "..."]
    }
  }
}
```

---

## 📋 PHASE 4: TYPE DEFINITIONS

### File: `src/types/errors.ts`

```typescript
export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface ErrorDefinition {
  // Identity
  key: string;           // SMOKE_TEST_FAILED
  code: string;          // PX-7004
  guid: string;          // BACKUP_FUNCTIONS-026
  module: string;        // BACKUP_FUNCTIONS
  
  // Q1: Where?
  file: string;
  functionName: string;
  
  // Q2: What?
  message: string;
  severity: ErrorSeverity;
  
  // Q3: Known failures?
  recovery: string;
  failureModes: string[];
  
  // Q4: Who triggered?
  calledBy: string[];
  calls: string[];
}

export interface TracedError extends Error {
  definition: ErrorDefinition;
  correlationId: string;
  context: Record<string, unknown>;
  timestamp: string;
}
```

---

## 📋 PHASE 5: ERROR CREATION

### File: `src/lib/traced-error.ts`

```typescript
import type { ErrorDefinition, TracedError } from '@/types/errors';

export function generateCorrelationId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}`;
}

export function createTracedError(
  definition: ErrorDefinition,
  options: {
    correlationId?: string;
    context?: Record<string, unknown>;
    cause?: Error;
  } = {}
): TracedError {
  const correlationId = options.correlationId ?? 
    generateCorrelationId(definition.module.toLowerCase());
  
  const error = new Error(definition.message) as TracedError;
  error.name = definition.code;
  error.definition = definition;
  error.correlationId = correlationId;
  error.context = options.context ?? {};
  error.timestamp = new Date().toISOString();
  
  if (options.cause) error.cause = options.cause;
  return error;
}

export async function logTracedError(
  error: TracedError,
  db?: FirebaseFirestore.Firestore
): Promise<void> {
  const entry = {
    code: error.definition.code,
    guid: error.definition.guid,
    module: error.definition.module,
    file: error.definition.file,
    functionName: error.definition.functionName,
    message: error.definition.message,
    severity: error.definition.severity,
    recovery: error.definition.recovery,
    failureModes: error.definition.failureModes,
    correlationId: error.correlationId,
    context: error.context,
    timestamp: new Date(),
    stack: error.stack,
    calledBy: error.definition.calledBy,
    calls: error.definition.calls
  };
  
  console.error(
    `\n❌ [${entry.code}] ${entry.message}\n` +
    `   GUID: ${entry.guid}\n` +
    `   File: ${entry.file}:${entry.functionName}\n` +
    `   Correlation: ${entry.correlationId}\n` +
    `   Recovery: ${entry.recovery}\n`
  );
  
  if (db) {
    await db.collection('error_logs').add(entry);
  } else if (typeof window !== 'undefined') {
    await fetch('/api/log-client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    });
  }
}
```

---

## 📋 PHASE 6: USAGE PATTERNS

### API Route
```typescript
import { ERRORS } from '@/lib/error-registry';
import { createTracedError, logTracedError } from '@/lib/traced-error';

try {
  // ... logic
} catch (error) {
  const traced = createTracedError(ERRORS.SCORE_CALCULATION_FAILED, {
    correlationId,
    context: { raceId, userId },
    cause: error instanceof Error ? error : undefined
  });
  await logTracedError(traced, db);
  return NextResponse.json({
    error: traced.definition.message,
    code: traced.definition.code,
    correlationId: traced.correlationId
  }, { status: 500 });
}
```

### Client Component
```typescript
const traced = createTracedError(ERRORS.PREDICTION_SUBMIT_FAILED, {
  context: { raceId, teamId }
});
await logTracedError(traced);
toast({
  variant: 'destructive',
  title: `Error ${traced.definition.code}`,
  description: (
    <div>
      <p>{traced.definition.message}</p>
      <code className="select-all">{traced.correlationId}</code>
    </div>
  )
});
```

---

## 📋 PHASE 7: CLAUDE CODE LOOKUP PROTOCOL

### Step 1: Identify What You Have

| User Says | Lookup Type |
|-----------|-------------|
| "smoke test error" | Topic |
| "PX-7004" | Error code |
| "BACKUP_FUNCTIONS-026" | GUID |
| "error in functions/src/index.ts" | File |

### Step 2: Consult Index FIRST

```bash
# Error code
cat docs/code-index.json | jq '.byErrorCode["PX-7004"]'

# Topic
cat docs/code-index.json | jq '.byTopic["smoke"]'

# Module
cat docs/code-index.json | jq '.byModule["BACKUP_FUNCTIONS"]'

# File
cat docs/code-index.json | jq '.byFile["functions/src/index.ts"]'
```

### Step 3: Get Full Context
```bash
cat docs/Code.json | jq '.guids[] | select(.guid == "BACKUP_FUNCTIONS-026")'
```

### Step 4: Go to Source
Open `location.filePath`, search for `location.functionName`.

### ❌ FORBIDDEN
- Grepping codebase for error codes
- Walking through files hoping to find issues
- Asking "which file should I look in?"
- Guessing file locations

### ✅ REQUIRED
- Always consult code-index.json first
- Report: GUID → File → Function → Recovery
- Use registry as source of truth

---

## 📋 PHASE 8: GOLDEN RULE #4 (ADD TO CLAUDE.MD)

```markdown
### 🛑 GOLDEN RULE #4: Registry-Sourced Errors

**Every error MUST be created from the error registry. No exceptions.**

#### The Four Diagnostic Questions

Every error log MUST answer automatically:

| # | Question | Answered By |
|---|----------|-------------|
| 1 | **Where did it fail?** | `file` + `functionName` + `correlationId` |
| 2 | **What was it trying to do?** | `message` + `context` |
| 3 | **Known failure modes?** | `recovery` + `failureModes` |
| 4 | **Who triggered it?** | `calledBy` + `calls` + `context` |

#### Required Pattern

```typescript
import { ERRORS } from '@/lib/error-registry';
import { createTracedError, logTracedError } from '@/lib/traced-error';

const traced = createTracedError(ERRORS.SMOKE_TEST_FAILED, {
  correlationId,
  context: { importPath, backupDate }
});
await logTracedError(traced, db);
throw traced;
```

#### Forbidden Patterns

```typescript
// ❌ NEVER hardcode error codes
throw new Error('PX-7004: Smoke test failed');

// ❌ NEVER manually construct metadata
logError('PX-7004', 'Smoke test failed', context);

// ❌ NEVER log without registry
console.error('[BACKUP_FUNCTIONS-026]', error);
```

#### Adding New Errors

1. Add to `errorProfile.emits` in Code.json
2. Run `npx ts-node scripts/generate-error-registry.ts`
3. Import `ERRORS.NEW_ERROR_KEY`
4. **Never skip generation step**

#### Lookup Protocol

When investigating errors:
1. Check `docs/code-index.json` first
2. Answer the four diagnostic questions
3. Report: GUID → File → Function → Recovery
4. Never grep blindly
```

---

## 📋 PHASE 9: MIGRATION CHECKLIST

### Schema Migration
- [ ] Add `location.filePath` to all 901 GUIDs
- [ ] Add `location.functionName` where applicable
- [ ] Add `errorProfile` to all error-throwing GUIDs
- [ ] Add `callChain` for orchestration GUIDs
- [ ] Validate: no `throws` without `emits`

### New Files
- [ ] Create `src/types/errors.ts`
- [ ] Create `src/lib/traced-error.ts`
- [ ] Create `scripts/generate-error-registry.ts`
- [ ] Generate `src/lib/error-registry.ts`
- [ ] Generate `docs/code-index.json`

### Code Migration
- [ ] Replace `logError()` → `logTracedError()`
- [ ] Replace hardcoded PX codes → `ERRORS.XXX`
- [ ] Replace `new Error('PX-...')` → `createTracedError()`
- [ ] Update `/api/log-client-error`

### Documentation
- [ ] Add Golden Rule #4 to CLAUDE.md

---

## 📋 PHASE 10: VALIDATION

```bash
# GUIDs missing location
cat docs/Code.json | jq '[.guids[] | select(.location == null)] | length'
# Target: 0

# throws without emits
cat docs/Code.json | jq '[.guids[] | select(.errorProfile.throws != null and .errorProfile.emits == null)] | .[].guid'
# Target: empty

# Hardcoded PX codes (should only be in error-registry.ts)
grep -r "PX-[0-9]\{4\}" src/ --include="*.ts" | grep -v error-registry.ts
# Target: none
```

---

## 🔄 MAINTENANCE

| Scenario | Action |
|----------|--------|
| Adding new code | Add GUID to Code.json with full schema, run generator |
| Error changes | Update `errorProfile.emits`, run generator |
| File moves | Update `location.filePath`, run generator |
| Debugging | Lookup in code-index.json → File → Function → Recovery |

---

**END OF MODULE-INDEXER.MD**
