/**
 * Extract ALL issues from book-of-works-01.json, not just criticalIssues
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'archived-book-of-works', 'book-of-works-01.json');
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

console.log('Analyzing book-of-works-01.json for ALL issues...\n');

// Check summary
if (data.summary) {
  console.log('Summary by severity:');
  if (data.summary.bySeverity) {
    Object.entries(data.summary.bySeverity).forEach(([severity, count]) => {
      console.log(`  ${severity}: ${count}`);
    });
  }
  console.log('\nSummary by category:');
  if (data.summary.byCategory) {
    Object.entries(data.summary.byCategory).forEach(([category, count]) => {
      console.log(`  ${category}: ${count}`);
    });
  }
}

// Check agentReports for individual issues
console.log('\n\nAgent Reports:');
if (data.agentReports) {
  Object.entries(data.agentReports).forEach(([agentId, report]) => {
    console.log(`\nAgent ${agentId}:`);
    console.log(`  Type: ${typeof report}`);
    if (typeof report === 'object') {
      console.log(`  Keys: ${Object.keys(report).join(', ')}`);
      if (report.issues && Array.isArray(report.issues)) {
        console.log(`  Issues array: ${report.issues.length} entries`);
      }
      if (report.findings && Array.isArray(report.findings)) {
        console.log(`  Findings array: ${report.findings.length} entries`);
      }
    }
  });
}

// Check for any other arrays or nested structures
console.log('\n\nSearching for all issue arrays...');
function findIssueArrays(obj, path = '') {
  if (Array.isArray(obj)) {
    if (obj.length > 0 && obj[0].id) {
      console.log(`  Found issue array at ${path}: ${obj.length} entries`);
      return obj;
    }
  } else if (typeof obj === 'object' && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      findIssueArrays(value, path ? `${path}.${key}` : key);
    }
  }
}

findIssueArrays(data);
