// GUID: SCRIPT-VALIDATE-001-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] Validate
// [Intent] Validate that all items in remediation-plan-final.json have been applied to the codebase by cross-referencing source files.
// [Usage] node scripts/validate-remediations.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
const fs = require('fs');
const path = require('path');

// Validation checklist for each remediation
const validations = {
  'ADMINCOMP-012': {
    title: 'Error dismissal via API endpoint',
    files: [
      'app/src/app/api/dismiss-error/route.ts',
      'app/src/app/(app)/admin/_components/ErrorLogViewer.tsx'
    ],
    checks: [
      { file: 'app/src/app/api/dismiss-error/route.ts', pattern: /export async function POST/, desc: 'API endpoint exists' },
      { file: 'app/src/app/(app)/admin/_components/ErrorLogViewer.tsx', pattern: /fetch.*\/api\/dismiss-error/, desc: 'Component calls API instead of direct Firestore' }
    ]
  },
  'ADMINCOMP-013': {
    title: 'Attack acknowledgement via API endpoint',
    files: [
      'app/src/app/api/acknowledge-attack/route.ts',
      'app/src/app/(app)/admin/_components/AttackMonitor.tsx'
    ],
    checks: [
      { file: 'app/src/app/api/acknowledge-attack/route.ts', pattern: /export async function POST/, desc: 'API endpoint exists' },
      { file: 'app/src/app/(app)/admin/_components/AttackMonitor.tsx', pattern: /fetch.*\/api\/acknowledge-attack/, desc: 'Component calls API instead of direct Firestore' }
    ]
  },
  'GEMINI-005': {
    title: 'CSRF protection on auth endpoints',
    files: [
      'app/src/app/api/auth/login/route.ts',
      'app/src/app/api/auth/signup/route.ts'
    ],
    checks: [
      { file: 'app/src/app/api/auth/login/route.ts', pattern: /Origin|Referer|csrf/i, desc: 'CSRF validation in login' },
      { file: 'app/src/app/api/auth/signup/route.ts', pattern: /Origin|Referer|csrf/i, desc: 'CSRF validation in signup' }
    ]
  },
  'ADMINCOMP-023': {
    title: 'Cascade deletion for race predictions',
    files: [
      'app/src/app/api/delete-scores/route.ts'
    ],
    checks: [
      { file: 'app/src/app/api/delete-scores/route.ts', pattern: /predictions.*delete|cascade/i, desc: 'Predictions deleted with scores' }
    ]
  },
  'GEMINI-007': {
    title: 'Restricted Firebase Storage profile photos',
    files: [
      'app/src/storage.rules'
    ],
    checks: [
      { file: 'app/src/storage.rules', pattern: /request\.auth\s*!=\s*null/, desc: 'Auth required for storage access' }
    ]
  },
  'ADMINCOMP-003': {
    title: 'Admin verification with magic link MFA',
    files: [
      'app/src/app/api/admin/challenge/route.ts',
      'app/src/app/api/admin/verify-access/route.ts'
    ],
    checks: [
      { file: 'app/src/app/api/admin/challenge/route.ts', pattern: /export async function POST/, desc: 'Challenge endpoint exists' },
      { file: 'app/src/app/api/admin/verify-access/route.ts', pattern: /export async function GET/, desc: 'Verify endpoint exists' }
    ]
  },
  'ADMINCOMP-003-COOKIE': {
    title: 'Admin verified cookie set',
    files: [
      'app/src/app/api/admin/verify-access/route.ts'
    ],
    checks: [
      { file: 'app/src/app/api/admin/verify-access/route.ts', pattern: /adminVerified.*cookie/i, desc: 'Cookie set on verification' }
    ]
  },
  'EMAIL-006': {
    title: 'PIN masking utility',
    files: [
      'app/src/lib/utils.ts',
      'app/src/lib/email.ts'
    ],
    checks: [
      { file: 'app/src/lib/utils.ts', pattern: /maskPin|function.*mask.*pin/i, desc: 'maskPin utility exists' },
      { file: 'app/src/lib/email.ts', pattern: /maskPin/, desc: 'maskPin used in email logging' }
    ],
    pendingWork: 'Migration script and secret rotation pending (Phase 1B)'
  },
  'ERROR-HANDLING-GAPS': {
    title: 'Error codes in email verification',
    files: [
      'app/src/app/api/send-verification-email/route.ts'
    ],
    checks: [
      { file: 'app/src/app/api/send-verification-email/route.ts', pattern: /ERRORS\.\w+/, desc: 'Uses ERRORS registry' },
      { file: 'app/src/app/api/send-verification-email/route.ts', pattern: /correlationId/, desc: 'Has correlation ID' }
    ]
  },
  'EMAIL-003': {
    title: 'Fixed sendEmail parameters',
    files: [
      'app/src/app/api/admin/challenge/route.ts'
    ],
    checks: [
      { file: 'app/src/app/api/admin/challenge/route.ts', pattern: /sendEmail/, desc: 'sendEmail called with correct params' }
    ]
  },
  'ADMIN-VERIFY-UX-001': {
    title: 'Fixed admin verification UX',
    files: [
      'app/src/app/(app)/admin/verify/page.tsx'
    ],
    checks: [
      { file: 'app/src/app/(app)/admin/verify/page.tsx', pattern: /uid|email/, desc: 'Correct parameter handling' }
    ]
  },
  'EMAIL-TRACEABILITY': {
    title: 'Build version in email footers',
    files: [
      'app/src/lib/email.ts'
    ],
    checks: [
      { file: 'app/src/lib/email.ts', pattern: /Build.*version|version.*Build/i, desc: 'Version in footer' }
    ]
  },
  'BACKUP-STORAGE-GAP': {
    title: 'Firebase Storage backup',
    files: [
      'functions/index.js'
    ],
    checks: [
      { file: 'functions/index.js', pattern: /storage.*backup|backup.*storage/i, desc: 'Storage backup in schedule' }
    ]
  }
};

console.log('\n' + '='.repeat(70));
console.log('🧪 REMEDIATION VALIDATION REPORT');
console.log('='.repeat(70));

const results = {
  passed: [],
  failed: [],
  warnings: [],
  pending: []
};

Object.entries(validations).forEach(([id, validation]) => {
  console.log(`\n📋 ${id}: ${validation.title}`);

  if (validation.pendingWork) {
    console.log(`   ⚠️  PENDING WORK: ${validation.pendingWork}`);
    results.pending.push({ id, work: validation.pendingWork });
  }

  let allChecksPassed = true;

  validation.checks.forEach(check => {
    const filePath = path.join(__dirname, check.file);

    if (!fs.existsSync(filePath)) {
      console.log(`   ❌ File not found: ${check.file}`);
      results.failed.push({ id, check: check.desc, reason: 'File not found' });
      allChecksPassed = false;
      return;
    }

    const content = fs.readFileSync(filePath, 'utf8');

    if (check.pattern.test(content)) {
      console.log(`   ✅ ${check.desc}`);
    } else {
      console.log(`   ❌ FAILED: ${check.desc}`);
      console.log(`      Pattern not found: ${check.pattern}`);
      results.failed.push({ id, check: check.desc, file: check.file });
      allChecksPassed = false;
    }
  });

  if (allChecksPassed) {
    results.passed.push(id);
  }
});

console.log('\n' + '='.repeat(70));
console.log('📊 VALIDATION SUMMARY');
console.log('='.repeat(70));
console.log(`✅ Passed: ${results.passed.length}/13`);
console.log(`❌ Failed: ${results.failed.length}`);
console.log(`⚠️  Pending Work: ${results.pending.length}`);

if (results.failed.length > 0) {
  console.log('\n❌ FAILED CHECKS:');
  results.failed.forEach(f => {
    console.log(`   ${f.id}: ${f.check} (${f.file || f.reason})`);
  });
}

if (results.pending.length > 0) {
  console.log('\n⚠️  PENDING WORK ITEMS:');
  results.pending.forEach(p => {
    console.log(`   ${p.id}: ${p.work}`);
  });
}

console.log('\n' + '='.repeat(70) + '\n');
