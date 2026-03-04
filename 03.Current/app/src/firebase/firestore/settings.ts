import { doc, getDoc, getDocFromServer, setDoc, serverTimestamp, Timestamp, Firestore, FieldValue, collection, query, orderBy, limit, addDoc, Query } from "firebase/firestore";

// ============================================
// Hot News Settings
// ============================================

// GUID: FIRESTORE_SETTINGS-000-v04
// [Intent] HotNews settings interface, defaults, and getHotNewsSettings reader — fetches the app-settings/hot-news doc from Firestore; returns in-memory defaults if missing (client SDK never writes defaults per GEMINI-AUDIT-022).
// [Inbound Trigger] Called by the Hot News feed component and the admin Hot News panel on mount.
// [Downstream Impact] Controls whether the Hot News feed is enabled, locked, and what content is displayed.
export interface HotNewsSettings {
    isLocked: boolean;
    hotNewsFeedEnabled: boolean;
    content: string;
    lastUpdated: Timestamp;
    refreshCount: number;
    messageId?: number; // Auto-incremented message identifier appended to AI-generated content as #0018 etc.
}

const defaultSettings: HotNewsSettings = {
    isLocked: false,
    hotNewsFeedEnabled: true,
    content: "Welcome to the Hot News Feed! The AI is warming up its engines...",
    lastUpdated: new Timestamp(0, 0),
    refreshCount: 0,
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
            // SECURITY_FIX (GEMINI-AUDIT-022): Do not write defaults via client SDK.
            // app-settings writes are server-side only (Admin SDK). Return defaults in-memory;
            // the document will be created on first admin save via /api/admin/update-hot-news.
            return defaultSettings;
        }
    } catch (error) {
        // @SECURITY_FIX (Wave 11): Gated console.error behind NODE_ENV — prevents raw Firebase error internals in prod console.
        if (process.env.NODE_ENV !== 'production') { console.error("Error getting hot news settings: ", error); }
        // Return default settings on error to ensure app functionality
        // Note: FirestorePermissionError is client-only, can't use in server context
        return defaultSettings;
    }
}

// ============================================
// WhatsApp Alert Settings
// ============================================

// GUID: FIRESTORE_SETTINGS-001-v01
// [Intent] TypeScript interfaces defining the WhatsApp alert configuration schema: per-alert-type toggle flags, master settings, and alert history entry shape — mirrors the admin_configuration/whatsapp_alerts Firestore document structure.
// [Inbound Trigger] Imported by WhatsApp alert admin panel, WhatsApp worker, and all alert send/read operations.
// [Downstream Impact] Changing these interfaces requires updating Firestore documents and the WhatsApp worker's expectations.
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
// GUID: FIRESTORE_SETTINGS-002-v01
// [Intent] Reads WhatsApp alert settings from admin_configuration/whatsapp_alerts; creates the document with defaults if absent (unlike hot-news, this collection is writable by the client admin).
// [Inbound Trigger] Called by the WhatsApp admin panel on mount to hydrate the settings form.
// [Downstream Impact] Settings doc controls which alert types are enabled and whether master send is active.
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
        // @SECURITY_FIX (Wave 11): Gated console.error behind NODE_ENV — prevents raw Firebase error internals in prod console.
        if (process.env.NODE_ENV !== 'production') { console.error("Error getting WhatsApp alert settings: ", error); }
        return defaultWhatsAppAlertSettings;
    }
}

/**
 * Updates WhatsApp alert settings in Firestore.
 * @param {Firestore} db - The Firestore instance.
 * @param {Partial<WhatsAppAlertSettings>} data - The data to update.
 */
// GUID: FIRESTORE_SETTINGS-003-v01
// [Intent] Merges partial WhatsApp alert settings into admin_configuration/whatsapp_alerts — used by the admin panel to toggle individual alert types or flip the master enable switch.
// [Inbound Trigger] Called by WhatsApp admin panel save handlers.
// [Downstream Impact] Changes persist to Firestore and are read by the WhatsApp worker before each send.
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
// GUID: FIRESTORE_SETTINGS-004-v01
// [Intent] Builds a Firestore Query for the whatsapp_alert_history collection, ordered by createdAt descending — returns a Query object for real-time listener attachment.
// [Inbound Trigger] Called by the WhatsApp admin history panel to set up an onSnapshot listener.
// [Downstream Impact] Used by the history table in the admin panel; not a fetch — the caller attaches a listener to the returned query.
export function getWhatsAppAlertHistoryQuery(db: Firestore, maxEntries: number = 50): Query {
    const historyRef = collection(db, "whatsapp_alert_history");
    return query(historyRef, orderBy("createdAt", "desc"), limit(maxEntries));
}

/**
 * Adds an entry to the WhatsApp alert history.
 * @param {Firestore} db - The Firestore instance.
 * @param {Omit<WhatsAppAlertHistoryEntry, 'id'>} entry - The history entry to add.
 */
// GUID: FIRESTORE_SETTINGS-005-v01
// [Intent] Appends a new entry to the whatsapp_alert_history collection, recording the alert type, message, target group, status, and timestamps for audit trail purposes.
// [Inbound Trigger] Called by WhatsApp send handlers (admin manual send + worker automated send) after each alert dispatch attempt.
// [Downstream Impact] Populates the alert history table in the admin panel; used for send/fail audit trail.
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

// GUID: FIRESTORE_SETTINGS-006-v01
// [Intent] PubChat settings interface, defaults, reader (getPubChatSettings), and writer (updatePubChatContent) — manages the app-settings/pub-chat document that holds the admin-editable Pub Chat announcement text.
// [Inbound Trigger] getPubChatSettings called by ThePaddockPubChat on mount; updatePubChatContent called by PubChatPanel admin save.
// [Downstream Impact] Controls what custom message text appears in the Paddock Pub Chat widget for all players.
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
        // @SECURITY_FIX (Wave 11): Gated console.error behind NODE_ENV — prevents raw Firebase error internals in prod console.
        if (process.env.NODE_ENV !== 'production') { console.error("Error getting pub chat settings: ", error); }
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
// Pub Chat Timing Data (OpenF1)
// ============================================

// GUID: FIRESTORE_SETTINGS-007-v01
// [Intent] TypeScript interfaces for OpenF1-sourced session timing data (PubChatTimingDriver, PubChatTimingData) — defines the shape of the app-settings/pub-chat-timing Firestore document.
// [Inbound Trigger] Imported by ThePaddockPubChat (display) and the admin fetch-timing API route (write).
// [Downstream Impact] Drives the leaderboard and team-lens views in the PubChat widget; tyreCompound field (FEAT-PC-001) added from OpenF1 stints data.
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
    tyreCompound?: string;     // FEAT-PC-001 Section 1: "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET" (from OpenF1 stints)
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
// GUID: FIRESTORE_SETTINGS-008-v01
// [Intent] Reads session timing data from app-settings/pub-chat-timing; returns null if absent; supports forceServer flag to bypass cache for freshness after an admin fetch.
// [Inbound Trigger] Called by ThePaddockPubChat on mount and after admin triggers a fresh OpenF1 data fetch.
// [Downstream Impact] Drives leaderboard/team-lens driver data in the PubChat widget; null return hides the timing section.
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
        // @SECURITY_FIX (Wave 11): Gated console.error behind NODE_ENV — prevents raw Firebase error internals in prod console.
        if (process.env.NODE_ENV !== 'production') { console.error("Error getting pub chat timing data: ", error); }
        return defaultPubChatTimingData;
    }
}
