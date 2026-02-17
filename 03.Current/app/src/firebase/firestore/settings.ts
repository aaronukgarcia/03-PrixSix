import { doc, getDoc, getDocFromServer, setDoc, serverTimestamp, Timestamp, Firestore, FieldValue, collection, query, orderBy, limit, getDocs, addDoc, Query } from "firebase/firestore";

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

// ============================================
// Pub Chat Settings
// ============================================

export interface PubChatSettings {
    content: string;
    lastUpdated: Timestamp;
    updatedBy: string;
}

const defaultPubChatSettings: PubChatSettings = {
    content: "",
    lastUpdated: new Timestamp(0, 0),
    updatedBy: "",
};

/**
 * Retrieves the pub chat settings from Firestore.
 * If the document doesn't exist, it returns default values.
 * @param {Firestore} db - The Firestore instance.
 * @param {boolean} forceServer - If true, bypasses cache and fetches from server.
 * @returns {Promise<PubChatSettings>} The current pub chat settings.
 */
export async function getPubChatSettings(db: Firestore, forceServer = false): Promise<PubChatSettings> {
    const settingsRef = doc(db, "app-settings", "pub-chat");
    try {
        const docSnap = forceServer
            ? await getDocFromServer(settingsRef)
            : await getDoc(settingsRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            return { ...defaultPubChatSettings, ...data } as PubChatSettings;
        } else {
            return defaultPubChatSettings;
        }
    } catch (error) {
        console.error("Error getting pub chat settings: ", error);
        return defaultPubChatSettings;
    }
}

/**
 * Updates the pub chat content in Firestore.
 * @param {Firestore} db - The Firestore instance.
 * @param {Partial<PubChatSettings>} data - The data to update.
 */
export async function updatePubChatContent(
    db: Firestore,
    data: Partial<Omit<PubChatSettings, 'lastUpdated'> & { lastUpdated?: FieldValue }>
) {
    const settingsRef = doc(db, "app-settings", "pub-chat");
    await setDoc(settingsRef, data, { merge: true });
}

// ============================================
// Audit Logging Settings
// ============================================

export interface AuditSettings {
    auditLoggingEnabled: boolean;
    lastUpdated: Timestamp;
    updatedBy: string;
}

const defaultAuditSettings: AuditSettings = {
    auditLoggingEnabled: true,
    lastUpdated: new Timestamp(0, 0),
    updatedBy: '',
};

/**
 * Retrieves audit logging settings from Firestore.
 * @param {Firestore} db - The Firestore instance.
 * @returns {Promise<AuditSettings>} The current audit settings.
 */
export async function getAuditSettings(db: Firestore): Promise<AuditSettings> {
    const settingsRef = doc(db, "admin_configuration", "audit_settings");
    try {
        const docSnap = await getDoc(settingsRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            return { ...defaultAuditSettings, ...data } as AuditSettings;
        } else {
            await setDoc(settingsRef, { ...defaultAuditSettings, lastUpdated: serverTimestamp() });
            return defaultAuditSettings;
        }
    } catch (error) {
        console.error("Error getting audit settings: ", error);
        return defaultAuditSettings;
    }
}

/**
 * Updates audit logging settings in Firestore.
 * @param {Firestore} db - The Firestore instance.
 * @param {Partial<AuditSettings>} data - The data to update.
 */
export async function updateAuditSettings(
    db: Firestore,
    data: Partial<Omit<AuditSettings, 'lastUpdated'> & { lastUpdated?: FieldValue }>
) {
    const settingsRef = doc(db, "admin_configuration", "audit_settings");
    await setDoc(settingsRef, data, { merge: true });
}

// ============================================
// Pub Chat Timing Data (OpenF1)
// ============================================

export interface PubChatTimingDriver {
    position: number;
    driver: string;            // Last name: "Verstappen"
    fullName: string;          // "Max VERSTAPPEN"
    driverNumber: number;
    team: string;              // "Red Bull Racing"
    teamColour: string;        // Hex without #: "3671C6"
    laps: number;
    bestLapDuration: number;   // Seconds (float)
    time: string;              // Formatted: "1:29.117"
}

export interface PubChatTimingData {
    session: {
        meetingKey: number;
        meetingName: string;
        sessionKey: number;
        sessionName: string;
        circuitName: string;
        location: string;
        countryName: string;
        dateStart: string;
    };
    drivers: PubChatTimingDriver[];
    fetchedAt: Timestamp;
    fetchedBy: string;
}

const defaultPubChatTimingData: PubChatTimingData | null = null;

/**
 * Retrieves the pub chat timing data from Firestore.
 * Returns null if the document doesn't exist or has no data.
 * @param {Firestore} db - The Firestore instance.
 * @param {boolean} forceServer - If true, bypasses cache and fetches from server.
 * @returns {Promise<PubChatTimingData | null>} The current timing data, or null.
 */
export async function getPubChatTimingData(db: Firestore, forceServer = false): Promise<PubChatTimingData | null> {
    const settingsRef = doc(db, "app-settings", "pub-chat-timing");
    try {
        const docSnap = forceServer
            ? await getDocFromServer(settingsRef)
            : await getDoc(settingsRef);
        if (docSnap.exists()) {
            return docSnap.data() as PubChatTimingData;
        }
        return defaultPubChatTimingData;
    } catch (error) {
        console.error("Error getting pub chat timing data: ", error);
        return defaultPubChatTimingData;
    }
}
