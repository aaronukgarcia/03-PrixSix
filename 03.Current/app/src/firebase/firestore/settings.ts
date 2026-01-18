import { doc, getDoc, setDoc, serverTimestamp, Timestamp, Firestore, FieldValue } from "firebase/firestore";
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

export interface HotNewsSettings {
    isLocked: boolean;
    hotNewsFeedEnabled: boolean;
    content: string;
    lastUpdated: Timestamp;
}

const defaultSettings: HotNewsSettings = {
    isLocked: false,
    hotNewsFeedEnabled: true,
    content: "Welcome to the Hot News Feed! The AI is warming up its engines...",
    lastUpdated: new Timestamp(0, 0),
};

/**
 * Retrieves the hot news settings from Firestore.
 * If the document doesn't exist, it returns default values.
 * @param {Firestore} db - The Firestore instance.
 * @returns {Promise<HotNewsSettings>} The current hot news settings.
 */
export async function getHotNewsSettings(db: Firestore): Promise<HotNewsSettings> {
    const settingsRef = doc(db, "app-settings", "hot-news");
    try {
        const docSnap = await getDoc(settingsRef);
        if (docSnap.exists()) {
            // Merge existing data with defaults to handle missing fields
            const data = docSnap.data();
            return { ...defaultSettings, ...data } as HotNewsSettings;
        } else {
            // Document doesn't exist, so let's create it with defaults
            await setDoc(settingsRef, { ...defaultSettings, lastUpdated: serverTimestamp() });
            return defaultSettings;
        }
    } catch (error) {
        console.error("Error getting hot news settings: ", error);
        
        const contextualError = new FirestorePermissionError({
          operation: 'get',
          path: settingsRef.path,
        });

        errorEmitter.emit('permission-error', contextualError);

        // Return default settings on error to ensure app functionality
        return defaultSettings;
    }
}

/**
 * Updates the hot news content and/or lock status in Firestore.
 * @param {Firestore} db - The Firestore instance.
 * @param {Partial<HotNewsSettings>} data - The data to update.
 */
export async function updateHotNewsContent(db: Firestore, data: Partial<Omit<HotNewsSettings, 'lastUpdated' | 'isLocked'> & { lastUpdated?: FieldValue, isLocked?: boolean, hotNewsFeedEnabled?: boolean, content?: string }>) {
    const settingsRef = doc(db, "app-settings", "hot-news");
    await setDoc(settingsRef, data, { merge: true });
}
