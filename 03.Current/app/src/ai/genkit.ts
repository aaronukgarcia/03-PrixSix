// GUID: AI_GENKIT-000-v05
// @FIX (PX-3101): gemini-2.0-flash was retired by Google for this project and returns HTTP 404
//   NOT_FOUND from Vertex generateContent in europe-west4 — every AI flow (race analysis,
//   hot-news, team-name generator, dynamic driver updates, pit chatter) failed silently with
//   AI_GENERATION_FAILED. Verified 2026-06-11 that gemini-2.5-flash returns 200 OK; moved to it.
// @MIGRATION (2026-06-11): Moved off the deprecated @genkit-ai/vertexai plugin (slated for removal)
//   to the unified @genkit-ai/google-genai plugin, using its Vertex AI backend. Auth (ADC via the
//   App Hosting compute service account), region (europe-west4), and the 'vertexai/<model>' naming
//   are all unchanged, so no new secret/API key is required. Verified e2e before deploy.
import {genkit} from 'genkit';
import {vertexAI} from '@genkit-ai/google-genai';

// Vertex AI backend via @genkit-ai/google-genai, using Application Default Credentials.
// Project: studio-6033436327-281b1, Location: europe-west4
export const ai = genkit({
  plugins: [vertexAI({
    projectId: process.env.GOOGLE_CLOUD_PROJECT,
    location: 'europe-west4',
  })],
  model: 'vertexai/gemini-2.5-flash',
});
