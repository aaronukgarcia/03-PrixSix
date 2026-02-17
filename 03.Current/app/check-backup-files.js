const { Storage } = require('@google-cloud/storage');
const path = require('path');

const storage = new Storage({ 
  projectId: 'prix6', 
  keyFilename: path.resolve(__dirname, '../service-account.json') 
});

async function listFiles() {
  const bucket = storage.bucket('prix6-backups');
  const [files] = await bucket.getFiles({ prefix: '2026-02-13T115410/' });
  
  console.log('\n=== Backup Files ===\n');
  files.slice(0, 20).forEach(f => {
    console.log(f.name);
  });
  console.log(`\n... and ${Math.max(0, files.length - 20)} more files`);
}

listFiles().catch(console.error);
