// GUID: AI_DEV-000-v02
// @BUGFIX (CHORE-TSC-001, BOW aDvk0c9DhdllnxTp3qSp): removed explicit `.ts` extensions from the
//   flow imports — TS5097 (allowImportingTsExtensions is off). Module resolution is identical;
//   no runtime change.
// [Intent] Genkit development entry point — loads env vars and imports all AI flow modules so Genkit's dev server discovers them for local testing.
// [Inbound Trigger] Run by `genkit dev` or `tsx src/ai/dev.ts` during local development only — never loaded in production.
// [Downstream Impact] Registers hot-news-feed, dynamic-driver-updates, and team-name-generator flows with the Genkit runtime for local inspection and testing.
import { config } from 'dotenv';
config();

import '@/ai/flows/dynamic-driver-updates';
import '@/ai/flows/hot-news-feed';
import '@/ai/flows/team-name-generator';
