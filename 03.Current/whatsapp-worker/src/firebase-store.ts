/**
 * Custom RemoteAuth store that saves WhatsApp session to Firebase Storage
 * This solves the ephemeral filesystem problem in containers
 */

import { getStorage } from './firebase-config';
import { Bucket } from '@google-cloud/storage';

interface SessionData {
  session: string;
  timestamp: number;
}

export class FirebaseSessionStore {
  private bucket: Bucket;
  private sessionPath: string;
  private clientId: string;

  constructor(clientId: string = 'prixsix-whatsapp') {
    this.clientId = clientId;
    this.sessionPath = `whatsapp-sessions/${clientId}`;
    this.bucket = getStorage().bucket();
  }

  /**
   * Check if a session exists in Firebase Storage
   */
  async sessionExists(): Promise<boolean> {
    try {
      const file = this.bucket.file(`${this.sessionPath}/session.json`);
      const [exists] = await file.exists();
      console.log(`📁 Session exists in Firebase Storage: ${exists}`);
      return exists;
    } catch (error) {
      console.error('Error checking session existence:', error);
      return false;
    }
  }

  /**
   * Save session data to Firebase Storage
   */
  async save(session: object): Promise<void> {
    try {
      const file = this.bucket.file(`${this.sessionPath}/session.json`);
      const data: SessionData = {
        session: JSON.stringify(session),
        timestamp: Date.now(),
      };

      await file.save(JSON.stringify(data), {
        contentType: 'application/json',
        metadata: {
          cacheControl: 'private, max-age=0',
        },
      });

      console.log('✅ Session saved to Firebase Storage');
    } catch (error) {
      console.error('❌ Error saving session:', error);
      throw error;
    }
  }

  /**
   * Load session data from Firebase Storage
   */
  async extract(): Promise<object | null> {
    try {
      const file = this.bucket.file(`${this.sessionPath}/session.json`);
      const [exists] = await file.exists();

      if (!exists) {
        console.log('📭 No existing session found');
        return null;
      }

      const [contents] = await file.download();
      const data: SessionData = JSON.parse(contents.toString());

      console.log(`✅ Session loaded from Firebase Storage (saved at ${new Date(data.timestamp).toISOString()})`);
      return JSON.parse(data.session);
    } catch (error) {
      console.error('❌ Error loading session:', error);
      return null;
    }
  }

  /**
   * Delete session from Firebase Storage
   */
  async delete(): Promise<void> {
    try {
      const [files] = await this.bucket.getFiles({ prefix: this.sessionPath });

      for (const file of files) {
        await file.delete();
      }

      console.log('🗑️ Session deleted from Firebase Storage');
    } catch (error) {
      console.error('❌ Error deleting session:', error);
    }
  }
}
