const fs = require('fs');
const path = require('path');

const CODE_JSON_PATH = path.join(__dirname, '../../code.json');

const data = JSON.parse(fs.readFileSync(CODE_JSON_PATH, 'utf-8'));
const now = new Date().toISOString();
let fixed = 0;

for (const guid of data.guids) {
  if (!guid.created || !guid.lastUpdated) {
    guid.created = now;
    guid.lastUpdated = now;
    fixed++;
    console.log('Fixed:', guid.guid);
  }
}

fs.writeFileSync(CODE_JSON_PATH, JSON.stringify(data, null, 2));
console.log('Total fixed:', fixed);
