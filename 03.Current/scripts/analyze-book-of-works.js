/**
 * Analyze structure of book-of-works-01.json
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'archived-book-of-works', 'book-of-works-01.json');
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

console.log('Top-level keys:', Object.keys(data));
console.log('\nStructure analysis:');

Object.keys(data).forEach(key => {
  const value = data[key];
  if (Array.isArray(value)) {
    console.log(`  ${key}: Array with ${value.length} entries`);
    if (value.length > 0) {
      console.log(`    First entry keys: ${Object.keys(value[0]).join(', ')}`);
    }
  } else if (typeof value === 'object' && value !== null) {
    const subKeys = Object.keys(value);
    console.log(`  ${key}: Object with ${subKeys.length} keys`);
    if (subKeys.length <= 10) {
      console.log(`    Keys: ${subKeys.join(', ')}`);
    }
  } else {
    console.log(`  ${key}: ${typeof value} = ${value}`);
  }
});

console.log('\nTotal issues by section:');
let total = 0;
Object.keys(data).forEach(key => {
  if (Array.isArray(data[key])) {
    total += data[key].length;
    console.log(`  ${key}: ${data[key].length}`);
  }
});
console.log(`  TOTAL: ${total}`);
