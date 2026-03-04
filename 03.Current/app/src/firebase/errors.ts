'use client';
import { getAuth, type User } from 'firebase/auth';

// GUID: FIREBASE_ERRORS-000-v01
// [Intent] Internal type definitions that model Firestore security rule objects (SecurityRuleContext, FirebaseAuthToken, FirebaseAuthObject, SecurityRuleRequest) for use in LLM-friendly error formatting.
// [Inbound Trigger] Used exclusively within this module by buildAuthObject, buildRequestObject, and FirestorePermissionError.
// [Downstream Impact] Changing these shapes changes the structure of error messages passed to the LLM debugger.
type SecurityRuleContext = {
  path: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete' | 'write';
  requestResourceData?: any;
};

interface FirebaseAuthToken {
  name: string | null;
  email: string | null;
  email_verified: boolean;
  phone_number: string | null;
  sub: string;
  firebase: {
    identities: Record<string, string[]>;
    sign_in_provider: string;
    tenant: string | null;
  };
}

interface FirebaseAuthObject {
  uid: string;
  token: FirebaseAuthToken;
}

interface SecurityRuleRequest {
  auth: FirebaseAuthObject | null;
  method: string;
  path: string;
  resource?: {
    data: any;
  };
}

// GUID: FIREBASE_ERRORS-001-v01
// [Intent] Converts a Firebase User into a FirebaseAuthObject that mirrors request.auth in Firestore security rules — used to build diagnostic error payloads.
// [Inbound Trigger] Called by buildRequestObject when a current user is available.
// [Downstream Impact] Populates the auth section of the structured error payload consumed by the LLM debugger.
/**
 * Builds a security-rule-compliant auth object from the Firebase User.
 * @param currentUser The currently authenticated Firebase user.
 * @returns An object that mirrors request.auth in security rules, or null.
 */
function buildAuthObject(currentUser: User | null): FirebaseAuthObject | null {
  if (!currentUser) {
    return null;
  }

  const token: FirebaseAuthToken = {
    name: currentUser.displayName,
    email: currentUser.email,
    email_verified: currentUser.emailVerified,
    phone_number: currentUser.phoneNumber,
    sub: currentUser.uid,
    firebase: {
      identities: currentUser.providerData.reduce((acc, p) => {
        if (p.providerId) {
          acc[p.providerId] = [p.uid];
        }
        return acc;
      }, {} as Record<string, string[]>),
      sign_in_provider: currentUser.providerData[0]?.providerId || 'custom',
      tenant: currentUser.tenantId,
    },
  };

  return {
    uid: currentUser.uid,
    token: token,
  };
}

// GUID: FIREBASE_ERRORS-002-v01
// [Intent] Assembles the full simulated SecurityRuleRequest by combining operation context with the current auth state — safe against uninitialized Firebase app.
// [Inbound Trigger] Called by FirestorePermissionError constructor during error construction.
// [Downstream Impact] The returned object is JSON-serialised into the error message for LLM debugging.
/**
 * Builds the complete, simulated request object for the error message.
 * It safely tries to get the current authenticated user.
 * @param context The context of the failed Firestore operation.
 * @returns A structured request object.
 */
function buildRequestObject(context: SecurityRuleContext): SecurityRuleRequest {
  let authObject: FirebaseAuthObject | null = null;
  try {
    // Safely attempt to get the current user.
    const firebaseAuth = getAuth();
    const currentUser = firebaseAuth.currentUser;
    if (currentUser) {
      authObject = buildAuthObject(currentUser);
    }
  } catch {
    // This will catch errors if the Firebase app is not yet initialized.
    // In this case, we'll proceed without auth information.
  }

  return {
    auth: authObject,
    method: context.operation,
    path: `/databases/(default)/documents/${context.path}`,
    resource: context.requestResourceData ? { data: context.requestResourceData } : undefined,
  };
}

// GUID: FIREBASE_ERRORS-003-v01
// [Intent] Formats the security rule request object into a human/LLM-readable string matching the Firestore "Missing or insufficient permissions" error format.
// [Inbound Trigger] Called by FirestorePermissionError constructor to set the error message.
// [Downstream Impact] The formatted string becomes Error.message — what the LLM debugger and error displays see.
/**
 * Builds the final, formatted error message for the LLM.
 * @param requestObject The simulated request object.
 * @returns A string containing the error message and the JSON payload.
 */
function buildErrorMessage(requestObject: SecurityRuleRequest): string {
  return `Missing or insufficient permissions: The following request was denied by Firestore Security Rules:
${JSON.stringify(requestObject, null, 2)}`;
}

// GUID: FIREBASE_ERRORS-004-v01
// [Intent] Custom error class that wraps Firestore permission failures with a structured request object mirroring security rules context — designed for LLM-assisted debugging.
// [Inbound Trigger] Instantiated in useCollection, useDoc error callbacks and non-blocking write catch blocks on permission-denied errors.
// [Downstream Impact] Emitted via errorEmitter to FirebaseErrorListener; the structured payload helps diagnose security rule mismatches during development.
/**
 * A custom error class designed to be consumed by an LLM for debugging.
 * It structures the error information to mimic the request object
 * available in Firestore Security Rules.
 */
export class FirestorePermissionError extends Error {
  public readonly request: SecurityRuleRequest;

  constructor(context: SecurityRuleContext) {
    const requestObject = buildRequestObject(context);
    super(buildErrorMessage(requestObject));
    this.name = 'FirebaseError';
    this.request = requestObject;
  }
}
