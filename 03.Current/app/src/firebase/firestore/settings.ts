import { doc, getDoc, setDoc, serverTimestamp, Timestamp, Firestore, FieldValue, collection, query, orderBy, limit, getDocs, addDoc, Query } from "firebase/firestore";

// ============================================
// Hot News Settings
// ============================================

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
        // Return default settings on error to ensure app functionality
        // Note: FirestorePermissionError is client-only, can't use in server context
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

// ============================================
// WhatsApp Alert Settings
// ============================================

export interface WhatsAppAlertToggles {
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
}

export interface WhatsAppAlertSettings {
    masterEnabled: boolean;
    testMode: boolean;
    targetGroup: string;
    alerts: WhatsAppAlertToggles;
    lastUpdated: Timestamp;
    updatedBy: string;
}

export interface WhatsAppAlertHistoryEntry {
    id?: string;
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

const defaultWhatsAppAlertSettings: WhatsAppAlertSettings = {
    masterEnabled: false,
    testMode: true,
    targetGroup: '',
    alerts: {
        qualifyingReminder: true,
        raceReminder: true,
        resultsPublished: true,
        newPlayerJoined: true,
        predictionSubmitted: false,
        latePredictionWarning: true,
        weeklyStandingsUpdate: true,
        endOfSeasonSummary: true,
        hotNewsPublished: true,
        adminAnnouncements: true,
        customMessages: true,
    },
    lastUpdated: new Timestamp(0, 0),
    updatedBy: '',
};

/**
 * Retrieves WhatsApp alert settings from Firestore.
 * @param {Firestore} db - The Firestore instance.
 * @returns {Promise<WhatsAppAlertSettings>} The current WhatsApp alert settings.
 */
export async function getWhatsAppAlertSettings(db: Firestore): Promise<WhatsAppAlertSettings> {
    const settingsRef = doc(db, "admin_configuration", "whatsapp_alerts");
    try {
        const docSnap = await getDoc(settingsRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            return {
                ...defaultWhatsAppAlertSettings,
                ...data,
                alerts: { ...defaultWhatsAppAlertSettings.alerts, ...data.alerts }
            } as WhatsAppAlertSettings;
        } else {
            await setDoc(settingsRef, { ...defaultWhatsAppAlertSettings, lastUpdated: serverTimestamp() });
            return defaultWhatsAppAlertSettings;
        }
    } catch (error) {
        console.error("Error getting WhatsApp alert settings: ", error);
        return defaultWhatsAppAlertSettings;
    }
}

/**
 * Updates WhatsApp alert settings in Firestore.
 * @param {Firestore} db - The Firestore instance.
 * @param {Partial<WhatsAppAlertSettings>} data - The data to update.
 */
export async function updateWhatsAppAlertSettings(
    db: Firestore,
    data: Partial<Omit<WhatsAppAlertSettings, 'lastUpdated'> & { lastUpdated?: FieldValue }>
) {
    const settingsRef = doc(db, "admin_configuration", "whatsapp_alerts");
    await setDoc(settingsRef, data, { merge: true });
}

/**
 * Gets the alert history query for real-time listening.
 * @param {Firestore} db - The Firestore instance.
 * @param {number} maxEntries - Maximum number of entries to fetch.
 * @returns {Query} The Firestore query.
 */
export function getWhatsAppAlertHistoryQuery(db: Firestore, maxEntries: number = 50): Query {
    const historyRef = collection(db, "whatsapp_alert_history");
    return query(historyRef, orderBy("createdAt", "desc"), limit(maxEntries));
}

/**
 * Adds an entry to the WhatsApp alert history.
 * @param {Firestore} db - The Firestore instance.
 * @param {Omit<WhatsAppAlertHistoryEntry, 'id'>} entry - The history entry to add.
 */
export async function addWhatsAppAlertHistoryEntry(
    db: Firestore,
    entry: Omit<WhatsAppAlertHistoryEntry, 'id' | 'createdAt'> & { createdAt?: FieldValue }
) {
    const historyRef = collection(db, "whatsapp_alert_history");
    await addDoc(historyRef, {
        ...entry,
        createdAt: entry.createdAt || serverTimestamp(),
    });
}
