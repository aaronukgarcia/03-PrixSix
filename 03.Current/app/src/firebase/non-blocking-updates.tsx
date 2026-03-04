'use client';
    
import {
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  CollectionReference,
  DocumentReference,
  SetOptions,
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import {FirestorePermissionError} from '@/firebase/errors';

// GUID: FIREBASE_NON_BLOCKING_UPDATES-000-v01
// [Intent] Fire-and-forget setDoc wrapper — writes the document without blocking the caller; emits permission-error via errorEmitter on failure.
// [Inbound Trigger] Used by components that need to write Firestore data without awaiting the result (e.g. user profile updates, preferences).
// [Downstream Impact] On permission failure, FirestorePermissionError is emitted to errorEmitter → caught by FirebaseErrorListener for display.
/**
 * Initiates a setDoc operation for a document reference.
 * Does NOT await the write operation internally.
 */
export function setDocumentNonBlocking(docRef: DocumentReference, data: any, options: SetOptions) {
  setDoc(docRef, data, options).catch(error => {
    errorEmitter.emit(
      'permission-error',
      new FirestorePermissionError({
        path: docRef.path,
        operation: 'write', // or 'create'/'update' based on options
        requestResourceData: data,
      })
    )
  })
  // Execution continues immediately
}


// GUID: FIREBASE_NON_BLOCKING_UPDATES-001-v01
// [Intent] Fire-and-forget addDoc wrapper — creates a new document without blocking; has explicit cascade-prevention logic for the error_logs collection to avoid infinite error loops.
// [Inbound Trigger] Used by error logging, audit trails, and any component that appends documents non-blocking.
// [Downstream Impact] skipErrorEmit=true must be set when writing to error_logs; otherwise permission failures propagate via errorEmitter.
/**
 * Initiates an addDoc operation for a collection reference.
 * Does NOT await the write operation internally.
 * Returns the Promise for the new doc ref, but typically not awaited by caller.
 *
 * @param skipErrorEmit - If true, don't emit to errorEmitter (use for error_logs to prevent cascade)
 */
export function addDocumentNonBlocking(colRef: CollectionReference, data: any, skipErrorEmit: boolean = false) {
  const promise = addDoc(colRef, data)
    .catch(error => {
      // Don't emit errors for error_logs writes (would cause infinite loop)
      // or when explicitly told to skip
      if (skipErrorEmit || colRef.path === 'error_logs') {
        console.error(`[Non-blocking write failed] ${colRef.path}:`, error?.message);
        return;
      }
      errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: colRef.path,
          operation: 'create',
          requestResourceData: data,
        })
      )
    });
  return promise;
}


// GUID: FIREBASE_NON_BLOCKING_UPDATES-002-v01
// [Intent] Fire-and-forget updateDoc wrapper — merges fields into an existing document without blocking; emits permission-error on failure.
// [Inbound Trigger] Used for partial field updates (e.g. user status, last-seen) where blocking is undesirable.
// [Downstream Impact] Permission failures propagate via errorEmitter to FirebaseErrorListener.
/**
 * Initiates an updateDoc operation for a document reference.
 * Does NOT await the write operation internally.
 */
export function updateDocumentNonBlocking(docRef: DocumentReference, data: any) {
  updateDoc(docRef, data)
    .catch(error => {
      errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: docRef.path,
          operation: 'update',
          requestResourceData: data,
        })
      )
    });
}


// GUID: FIREBASE_NON_BLOCKING_UPDATES-003-v01
// [Intent] Fire-and-forget deleteDoc wrapper — removes a document without blocking the caller; emits permission-error on failure.
// [Inbound Trigger] Used for UI-triggered deletions where immediate feedback is not required.
// [Downstream Impact] Permission failures propagate via errorEmitter to FirebaseErrorListener.
/**
 * Initiates a deleteDoc operation for a document reference.
 * Does NOT await the write operation internally.
 */
export function deleteDocumentNonBlocking(docRef: DocumentReference) {
  deleteDoc(docRef)
    .catch(error => {
      errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: docRef.path,
          operation: 'delete',
        })
      )
    });
}
