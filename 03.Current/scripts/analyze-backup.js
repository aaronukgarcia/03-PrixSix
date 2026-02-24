// GUID: SCRIPT-ANALYZE-001-v01
// [Type] Utility Script — outside production build, used in development and testing
// [Category] Analysis
// [Intent] Parse and analyse a local JSON backup file of Firestore data to verify document counts and structure.
// [Usage] node scripts/analyze-backup.js (run from project root)
// [Moved] 2026-02-24 from project root — codebase tidy-up
//
const fs = require('fs');

// Read backup file
const backup = JSON.parse(fs.readFileSync('./email-logs-backup/backup-2026-02-17/email-logs-plaintext-pins.json', 'utf8'));

console.log('\n' + '='.repeat(70));
console.log('📊 BACKUP FILE ANALYSIS - EMAIL-006 Phase 1C');
console.log('='.repeat(70));
console.log(`\nBackup timestamp: ${backup.timestamp}`);
console.log(`Total documents in backup: ${backup.documentsCount}`);

// Analyze PIN values
const pinStats = {
  'N/A': 0,
  'numeric6digit': [],
  'other': []
};

const uniquePins = new Set();
const realPinEmails = [];

backup.documents.forEach(doc => {
  const pin = doc.data.pin;
  uniquePins.add(pin);

  if (pin === 'N/A') {
    pinStats['N/A']++;
  } else if (/^\d{6}$/.test(pin)) {
    pinStats.numeric6digit.push(pin);
    realPinEmails.push({
      to: doc.data.to,
      subject: doc.data.subject,
      pin: pin,
      timestamp: doc.data.timestamp,
      status: doc.data.status
    });
  } else {
    pinStats.other.push(pin);
  }
});

console.log('\n' + '='.repeat(70));
console.log('PIN VALUE DISTRIBUTION');
console.log('='.repeat(70));
console.log(`"N/A" values (result emails):     ${pinStats['N/A']}`);
console.log(`6-digit numeric PINs (REAL):      ${pinStats.numeric6digit.length}`);
console.log(`Other values:                     ${pinStats.other.length}`);
console.log(`Total unique PIN values:          ${uniquePins.size}`);

if (pinStats.numeric6digit.length > 0) {
  console.log('\n' + '='.repeat(70));
  console.log('⚠️  CRITICAL: REAL PINs FOUND IN LOGS');
  console.log('='.repeat(70));
  console.log(`\nTotal emails with real PINs: ${realPinEmails.length}`);

  // Group by unique PIN
  const pinGroups = {};
  realPinEmails.forEach(email => {
    if (!pinGroups[email.pin]) {
      pinGroups[email.pin] = [];
    }
    pinGroups[email.pin].push(email);
  });

  console.log(`Unique real PINs logged: ${Object.keys(pinGroups).length}`);

  console.log('\n📋 BREAKDOWN BY PIN:');
  Object.entries(pinGroups).forEach(([pin, emails]) => {
    console.log(`\n  PIN: ${pin}`);
    console.log(`  Logged: ${emails.length} time(s)`);
    console.log(`  Recipients:`);

    const uniqueRecipients = new Set(emails.map(e => e.to));
    uniqueRecipients.forEach(recipient => {
      const recipientEmails = emails.filter(e => e.to === recipient);
      console.log(`    - ${recipient} (${recipientEmails.length} email(s))`);
    });
  });

  console.log('\n' + '='.repeat(70));
  console.log('🔐 CREDENTIAL ROTATION REQUIRED');
  console.log('='.repeat(70));
  console.log('\nAFFECTED USERS:');
  const affectedUsers = new Set(realPinEmails.map(e => e.to));
  affectedUsers.forEach(user => {
    console.log(`  ⚠️  ${user}`);
  });

  console.log(`\nTotal affected users: ${affectedUsers.size}`);

  console.log('\n📋 REMEDIATION STEPS:');
  console.log('1. Force password reset for affected users');
  console.log('2. Notify users of potential credential exposure');
  console.log('3. Review email_logs access permissions');
  console.log('4. Document incident in security audit log');
  console.log('5. Delete backup file after remediation');

} else {
  console.log('\n' + '='.repeat(70));
  console.log('✅ GOOD NEWS: NO REAL PINs FOUND');
  console.log('='.repeat(70));
  console.log('\nAll logged PIN values are "N/A" (result emails).');
  console.log('No actual user credentials were exposed.');
  console.log('\nPhase 1C Result: No credential rotation needed!');
}

if (pinStats.other.length > 0) {
  console.log('\n' + '='.repeat(70));
  console.log('OTHER PIN VALUES FOUND');
  console.log('='.repeat(70));

  const otherUnique = new Set(pinStats.other);
  console.log(`Unique "other" values: ${otherUnique.size}`);

  otherUnique.forEach(val => {
    const count = pinStats.other.filter(v => v === val).length;
    console.log(`  "${val}": ${count} occurrence(s)`);
  });
}

console.log('\n' + '='.repeat(70));
console.log('ANALYSIS COMPLETE');
console.log('='.repeat(70) + '\n');
