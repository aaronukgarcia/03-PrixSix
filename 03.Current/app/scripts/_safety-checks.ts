// GUID: SCRIPTS_SAFETY-000-v01
// @PHASE_4B: Safety checks for destructive operational scripts (DEPLOY-003 mitigation).
// [Intent] Provides environment validation and user confirmation to prevent accidental
//          execution of destructive scripts against production database.
// [Inbound Trigger] Imported by destructive scripts that delete/modify/migrate production data.
// [Downstream Impact] Blocks script execution if production project ID detected or user does not confirm.
//                     Prevents data loss incidents caused by running dev/test scripts on prod.

import * as readline from 'readline';

// GUID: SCRIPTS_SAFETY-001-v01
// [Intent] Production project ID that scripts MUST NOT run against (prix-six production).
// [Inbound Trigger] Checked by ensureNotProduction() before any destructive operation.
// [Downstream Impact] Update this if production project ID changes. Scripts will fail if they detect this ID.
const PRODUCTION_PROJECT_ID = 'prix-six';

// GUID: SCRIPTS_SAFETY-002-v01
// [Intent] Test/development project ID that scripts SHOULD run against for safe testing.
// [Inbound Trigger] Displayed in error messages when production is detected.
// [Downstream Impact] Developers should create this Firebase project for safe script testing.
const TEST_PROJECT_ID = 'prix6-test';

// GUID: SCRIPTS_SAFETY-003-v01
// [Intent] Check if script is running against production environment and block execution if true.
//          Checks both FIREBASE_PROJECT_ID and GOOGLE_CLOUD_PROJECT environment variables.
// [Inbound Trigger] Called at start of every destructive script.
// [Downstream Impact] Throws error and exits process if production detected. Prevents accidental data loss.
export function ensureNotProduction(): void {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;

  if (!projectId) {
    console.warn('⚠️  WARNING: No project ID detected (FIREBASE_PROJECT_ID or GOOGLE_CLOUD_PROJECT not set)');
    console.warn('⚠️  Proceeding with default credentials - ensure you are NOT targeting production!');
    console.warn('');
    return;
  }

  if (projectId === PRODUCTION_PROJECT_ID) {
    console.error('❌ ERROR: This script cannot run against production database!');
    console.error('');
    console.error(`   Detected project: ${projectId}`);
    console.error(`   Production ID:    ${PRODUCTION_PROJECT_ID}`);
    console.error('');
    console.error('   This is a DESTRUCTIVE script that modifies/deletes data.');
    console.error('   Running it against production would cause DATA LOSS.');
    console.error('');
    console.error(`   To run this script safely, use the test project: ${TEST_PROJECT_ID}`);
    console.error('');
    console.error('   Example:');
    console.error(`   $env:FIREBASE_PROJECT_ID = "${TEST_PROJECT_ID}"`);
    console.error('   npx ts-node --project tsconfig.scripts.json scripts/your-script.ts');
    console.error('');
    process.exit(1);
  }

  console.log(`✅ Safe to proceed: Running against project '${projectId}' (not production)`);
  console.log('');
}

// GUID: SCRIPTS_SAFETY-004-v01
// [Intent] Require user to type "CONFIRM" before proceeding with destructive operation.
//          Provides last-chance confirmation after environment checks pass.
// [Inbound Trigger] Called by destructive scripts after ensureNotProduction().
// [Downstream Impact] Returns a Promise that resolves if user confirms, rejects if user cancels.
//                     Prevents accidental execution via mistyped commands or automated processes.
export async function requireConfirmation(scriptDescription: string): Promise<void> {
  console.log('');
  console.log('⚠️  ═══════════════════════════════════════════════════════════════');
  console.log(`⚠️  WARNING: You are about to run a DESTRUCTIVE operation:`);
  console.log(`⚠️  ${scriptDescription}`);
  console.log('⚠️  ═══════════════════════════════════════════════════════════════');
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<void>((resolve, reject) => {
    rl.question('Type "CONFIRM" (all caps) to proceed, or anything else to cancel: ', (answer) => {
      rl.close();

      if (answer.trim() === 'CONFIRM') {
        console.log('');
        console.log('✅ Confirmed. Proceeding with operation...');
        console.log('');
        resolve();
      } else {
        console.log('');
        console.log('❌ Operation cancelled by user.');
        console.log('');
        reject(new Error('User cancelled operation'));
      }
    });
  });
}

// GUID: SCRIPTS_SAFETY-005-v01
// [Intent] Combined safety check: environment validation + user confirmation.
//          Single function to call at the start of any destructive script.
// [Inbound Trigger] Called by destructive scripts before any Firebase operations.
// [Downstream Impact] Ensures both environment safety and user intent before proceeding.
export async function runSafetyChecks(scriptDescription: string): Promise<void> {
  ensureNotProduction();
  await requireConfirmation(scriptDescription);
}

// GUID: SCRIPTS_SAFETY-006-v01
// [Intent] Helper to display script usage instructions with safety guidelines.
// [Inbound Trigger] Called by scripts when invoked with --help or invalid arguments.
// [Downstream Impact] Educates users on safe script execution practices.
export function displayUsage(scriptName: string, description: string, usage: string): void {
  console.log('');
  console.log(`${scriptName}`);
  console.log('='.repeat(scriptName.length));
  console.log('');
  console.log(description);
  console.log('');
  console.log('SAFETY:');
  console.log(`  • This script CANNOT run against production (${PRODUCTION_PROJECT_ID})`);
  console.log(`  • Use test project for safe execution: ${TEST_PROJECT_ID}`);
  console.log('  • You will be prompted to type "CONFIRM" before execution');
  console.log('');
  console.log('USAGE:');
  console.log(`  ${usage}`);
  console.log('');
  console.log('ENVIRONMENT SETUP:');
  console.log(`  $env:FIREBASE_PROJECT_ID = "${TEST_PROJECT_ID}"`);
  console.log(`  $env:GOOGLE_APPLICATION_CREDENTIALS = ".\\service-account-test.json"`);
  console.log('');
}
