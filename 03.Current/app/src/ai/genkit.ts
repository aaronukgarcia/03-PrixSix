import {genkit} from 'genkit';
import {vertexAI} from '@genkit-ai/vertexai';

// Use Vertex AI with service account credentials (GOOGLE_APPLICATION_CREDENTIALS)
// Project: studio-6033436327-281b1, Location: europe-west4
export const ai = genkit({
  plugins: [vertexAI({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || 'studio-6033436327-281b1',
    location: 'europe-west4',
  })],
  model: 'vertexai/gemini-2.0-flash',
});
