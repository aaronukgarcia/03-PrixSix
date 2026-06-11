// GUID: AI_GENKIT-000-v04
// @FIX (PX-3101): gemini-2.0-flash was retired by Google for this project and returns HTTP 404
//   NOT_FOUND from Vertex generateContent in europe-west4 — every AI flow (race analysis,
//   hot-news, team-name generator, dynamic driver updates, pit chatter) failed silently with
//   AI_GENERATION_FAILED. Verified 2026-06-11 that gemini-2.5-flash (and -lite) return 200 OK in
//   europe-west4; moved to gemini-2.5-flash. Reported by user "Al" hitting PX-3101 on AI analysis.
import {genkit} from 'genkit';
import {vertexAI} from '@genkit-ai/vertexai';

// Use Vertex AI with service account credentials (GOOGLE_APPLICATION_CREDENTIALS)
// Project: studio-6033436327-281b1, Location: europe-west4
export const ai = genkit({
  plugins: [vertexAI({
    projectId: process.env.GOOGLE_CLOUD_PROJECT,
    location: 'europe-west4',
  })],
  model: 'vertexai/gemini-2.5-flash',
});
