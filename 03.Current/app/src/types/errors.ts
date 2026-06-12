// GUID: TYPES_ERRORS-000-v03
// [Intent] TypeScript interfaces for the traced-error system. Defines the shape of error definitions
//          (from code.json), traced error instances (runtime), and severity levels. Every error in the
//          system answers four diagnostic questions: Where? What? Known failures? Who triggered it?
// [Inbound Trigger] Imported by traced-error.ts, error-registry.ts, and any code that creates or handles traced errors.
// [Downstream Impact] Changing these interfaces affects error creation, logging, and display across the entire app.

export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

// GUID: TYPES_ERRORS-001-v03
// [Intent] Defines the full shape of an error definition sourced from code.json's errorProfile.emits entries.
//          Each field answers one of the four diagnostic questions required by Golden Rule #7.
// [Inbound Trigger] Populated by generate-error-registry.ts from code.json. Referenced at runtime by createTracedError.
// [Downstream Impact] Adding fields here requires updating the generator script and all error creation call sites.
export interface ErrorDefinition {
  // Identity
  key: string;           // e.g. SMOKE_TEST_FAILED
  code: string;          // e.g. PX-7004
  guid: string;          // e.g. BACKUP_FUNCTIONS-026
  module: string;        // e.g. BACKUP_FUNCTIONS

  // Q1: Where did it fail?
  file: string;
  functionName: string;

  // Q2: What was it trying to do?
  message: string;
  severity: ErrorSeverity;

  // Q3: Known failure modes?
  recovery: string;
  failureModes: string[];

  // Q4: Who triggered it?
  calledBy: string[];
  calls: string[];
}

// GUID: TYPES_ERRORS-001b-v01
// [Intent] Lighter error-definition shape for subsystems (e.g. Pit Wall) that only need the
//          user-facing fields (code/message) and don't carry the full Q1–Q4 diagnostic metadata.
//          Registry entries of this shape are consumed only for `.code`/`.message`, never passed
//          to createTracedError() (which requires the full ErrorDefinition).
// [Downstream Impact] Part of the ERRORS `satisfies` union so these entries type-check while the
//                     overall registry keeps exact-key safety.
export interface LightErrorDefinition {
  key: string;
  code: string;
  message: string;
  severity: ErrorSeverity;
  description?: string;
  suggestedAction?: string;
  modulePath?: string;
}

// GUID: TYPES_ERRORS-002-v03
// [Intent] Extends the standard Error with traced-error metadata. Created at runtime by createTracedError()
//          and passed to logTracedError() for persistence. The correlationId links user reports to server logs.
// [Inbound Trigger] Created by catch blocks via createTracedError(). Consumed by logTracedError() and UI error displays.
// [Downstream Impact] Changing this shape affects all error logging and display code. The correlationId format
//                     must remain parseable by support workflows.
export interface TracedError extends Error {
  definition: ErrorDefinition;
  correlationId: string;
  context: Record<string, unknown>;
  timestamp: string;
}
