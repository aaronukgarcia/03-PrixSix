'use client';
import { FirestorePermissionError } from '@/firebase/errors';

// GUID: FIREBASE_ERROR_EMITTER-000-v01
// [Intent] Defines the AppEvents interface — the typed event contract for all Firebase error signals in the app. Adding a new event type here widens the emitter's type signature.
// [Inbound Trigger] Imported by createEventEmitter and all call-sites that subscribe or emit events.
// [Downstream Impact] Changes to this interface cascade to all on()/emit() call-sites via TypeScript compile-time enforcement.
/**
 * Defines the shape of all possible events and their corresponding payload types.
 * This centralizes event definitions for type safety across the application.
 */
export interface AppEvents {
  'permission-error': FirestorePermissionError;
}

// A generic type for a callback function.
type Callback<T> = (data: T) => void;

// GUID: FIREBASE_ERROR_EMITTER-001-v01
// [Intent] Generic strongly-typed pub/sub factory — returns an emitter object with on/off/emit methods constrained to the event map type T.
// [Inbound Trigger] Called once at module load to create the errorEmitter singleton.
// [Downstream Impact] Provides the type-safe subscription infrastructure used by useCollection, useDoc, non-blocking writes, and FirebaseErrorListener.
/**
 * A strongly-typed pub/sub event emitter.
 * It uses a generic type T that extends a record of event names to payload types.
 */
function createEventEmitter<T extends Record<string, any>>() {
  // The events object stores arrays of callbacks, keyed by event name.
  // The types ensure that a callback for a specific event matches its payload type.
  const events: { [K in keyof T]?: Array<Callback<T[K]>> } = {};

  return {
    /**
     * Subscribe to an event.
     * @param eventName The name of the event to subscribe to.
     * @param callback The function to call when the event is emitted.
     */
    on<K extends keyof T>(eventName: K, callback: Callback<T[K]>) {
      if (!events[eventName]) {
        events[eventName] = [];
      }
      events[eventName]?.push(callback);
    },

    /**
     * Unsubscribe from an event.
     * @param eventName The name of the event to unsubscribe from.
     * @param callback The specific callback to remove.
     */
    off<K extends keyof T>(eventName: K, callback: Callback<T[K]>) {
      if (!events[eventName]) {
        return;
      }
      events[eventName] = events[eventName]?.filter(cb => cb !== callback);
    },

    /**
     * Publish an event to all subscribers.
     * @param eventName The name of the event to emit.
     * @param data The data payload that corresponds to the event's type.
     */
    emit<K extends keyof T>(eventName: K, data: T[K]) {
      if (!events[eventName]) {
        return;
      }
      events[eventName]?.forEach(callback => callback(data));
    },
  };
}

// GUID: FIREBASE_ERROR_EMITTER-002-v01
// [Intent] Module-level singleton errorEmitter typed with AppEvents — the single hub through which all Firestore permission errors propagate to FirebaseErrorListener for display.
// [Inbound Trigger] Imported by non-blocking-updates, use-collection, use-doc (emit side) and FirebaseErrorListener (subscribe side).
// [Downstream Impact] Permission error toast/modal display depends on this singleton being the same module-level reference across all importers.
// Create and export a singleton instance of the emitter, typed with our AppEvents interface.
export const errorEmitter = createEventEmitter<AppEvents>();
