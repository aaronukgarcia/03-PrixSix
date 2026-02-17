/**
 * Decode Firestore export and restore race_results
 *
 * Uses protobufjs to decode Datastore Entity format from export files
 */

import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Storage } from '@google-cloud/storage';
import * as protobuf from 'protobufjs';

const serviceAccount = require(path.resolve(__dirname, '../../service-account.json'));
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'studio-6033436327-281b1'
  });
}
const db = admin.firestore();
const storage = new Storage({
  projectId: 'studio-6033436327-281b1',
  keyFilename: path.resolve(__dirname, '../../service-account.json')
});

const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--live');
const BACKUP_PATH = '2026-02-13T115410/firestore/all_namespaces/all_kinds';
const BUCKET_NAME = 'prix6-backups';

// Datastore Entity proto schema (simplified version)
const entityProtoJson = {
  nested: {
    google: {
      nested: {
        datastore: {
          nested: {
            v1: {
              nested: {
                Entity: {
                  fields: {
                    key: { type: 'Key', id: 1 },
                    properties: { keyType: 'string', type: 'Value', id: 3, rule: 'map' }
                  }
                },
                Key: {
                  fields: {
                    partitionId: { type: 'PartitionId', id: 1 },
                    path: { rule: 'repeated', type: 'PathElement', id: 2 }
                  }
                },
                PartitionId: {
                  fields: {
                    projectId: { type: 'string', id: 2 },
                    namespaceId: { type: 'string', id: 4 }
                  }
                },
                PathElement: {
                  fields: {
                    kind: { type: 'string', id: 1 },
                    id: { type: 'int64', id: 2 },
                    name: { type: 'string', id: 3 }
                  }
                },
                Value: {
                  oneofs: {
                    valueType: {
                      oneof: [
                        'nullValue',
                        'booleanValue',
                        'integerValue',
                        'doubleValue',
                        'timestampValue',
                        'keyValue',
                        'stringValue',
                        'blobValue',
                        'geoPointValue',
                        'entityValue',
                        'arrayValue'
                      ]
                    }
                  },
                  fields: {
                    nullValue: { type: 'int32', id: 11 },
                    booleanValue: { type: 'bool', id: 1 },
                    integerValue: { type: 'int64', id: 2 },
                    doubleValue: { type: 'double', id: 3 },
                    timestampValue: { type: 'google.protobuf.Timestamp', id: 10 },
                    keyValue: { type: 'Key', id: 5 },
                    stringValue: { type: 'string', id: 17 },
                    blobValue: { type: 'bytes', id: 18 },
                    geoPointValue: { type: 'google.type.LatLng', id: 8 },
                    entityValue: { type: 'Entity', id: 6 },
                    arrayValue: { type: 'ArrayValue', id: 9 }
                  }
                },
                ArrayValue: {
                  fields: {
                    values: { rule: 'repeated', type: 'Value', id: 1 }
                  }
                }
              }
            }
          }
        },
        protobuf: {
          nested: {
            Timestamp: {
              fields: {
                seconds: { type: 'int64', id: 1 },
                nanos: { type: 'int32', id: 2 }
              }
            }
          }
        },
        type: {
          nested: {
            LatLng: {
              fields: {
                latitude: { type: 'double', id: 1 },
                longitude: { type: 'double', id: 2 }
              }
            }
          }
        }
      }
    }
  }
};

function convertValueToFirestore(value: any): any {
  if (!value) return null;

  if (value.nullValue !== undefined) return null;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.integerValue !== undefined) return parseInt(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.timestampValue) {
    const seconds = parseInt(value.timestampValue.seconds || 0);
    const nanos = value.timestampValue.nanos || 0;
    return admin.firestore.Timestamp.fromMillis(seconds * 1000 + nanos / 1000000);
  }
  if (value.arrayValue) {
    return value.arrayValue.values.map((v: any) => convertValueToFirestore(v));
  }
  if (value.entityValue && value.entityValue.properties) {
    const obj: any = {};
    for (const [key, val] of Object.entries(value.entityValue.properties)) {
      obj[key] = convertValueToFirestore(val);
    }
    return obj;
  }

  return null;
}

async function decodeAndRestore() {
  try {
    console.log('\n🔓 DECODE & RESTORE: Race Results from Protobuf Export');
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : '🟢 LIVE RESTORE'}\n`);

    // Load protobuf definitions
    console.log('📦 Loading protobuf schema...');
    const root = protobuf.Root.fromJSON(entityProtoJson);
    const EntityType = root.lookupType('google.datastore.v1.Entity');
    console.log('✓ Schema loaded\n');

    const bucket = storage.bucket(BUCKET_NAME);

    // List all output files
    console.log('📂 Listing backup export files...');
    const [files] = await bucket.getFiles({ prefix: BACKUP_PATH });
    const outputFiles = files.filter(f => f.name.includes('output-')).sort();
    console.log(`✓ Found ${outputFiles.length} export files\n`);

    // Create temp directory
    const tempDir = path.join(os.tmpdir(), 'firestore-decode');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const raceResults: Array<{ id: string; data: any }> = [];
    const kindsFound = new Set<string>();
    let totalEntities = 0;

    console.log('📥 Downloading and decoding export files...');
    console.log('   (This may take a few minutes for 60 files)\n');

    for (let i = 0; i < outputFiles.length; i++) {
      const file = outputFiles[i];
      const filename = path.basename(file.name);

      if (i % 10 === 0) {
        console.log(`  Processing file ${i + 1}/${outputFiles.length}...`);
      }

      const localPath = path.join(tempDir, filename);
      await file.download({ destination: localPath });

      // Read and parse file
      const buffer = fs.readFileSync(localPath);
      let offset = 0;

      while (offset < buffer.length - 1) {
        try {
          // Read varint length
          let length = 0;
          let shift = 0;
          let b = 0;

          do {
            if (offset >= buffer.length) break;
            b = buffer[offset++];
            length |= (b & 0x7f) << shift;
            shift += 7;
          } while ((b & 0x80) && shift < 64);

          if (length === 0 || length > buffer.length || offset + length > buffer.length) {
            break;
          }

          // Read record
          const recordBuffer = buffer.slice(offset, offset + length);
          offset += length;

          // Try to decode as Entity
          try {
            const entity = EntityType.decode(recordBuffer);
            const entityObj = EntityType.toObject(entity, {
              longs: String,
              enums: String,
              bytes: String
            });

            totalEntities++;

            // Debug: Log first entity structure
            if (totalEntities <= 3) {
              console.log(`\n  DEBUG Entity #${totalEntities}:`);
              console.log(`    Keys: ${Object.keys(entityObj).join(', ')}`);
              console.log(`    Full: ${JSON.stringify(entityObj).substring(0, 500)}`);
            }

            // Check if this is a race_results document
            if (entityObj.key && entityObj.key.path && entityObj.key.path.length > 0) {
              const kind = entityObj.key.path[entityObj.key.path.length - 1].kind;
              kindsFound.add(kind);

              if (kind === 'race_results') {
                const docId = entityObj.key.path[entityObj.key.path.length - 1].name ||
                  entityObj.key.path[entityObj.key.path.length - 1].id;

                // Convert properties to Firestore format
                const data: any = {};
                if (entityObj.properties) {
                  for (const [key, value] of Object.entries(entityObj.properties)) {
                    data[key] = convertValueToFirestore(value);
                  }
                }

                raceResults.push({ id: docId, data });
                console.log(`    ✓ Found race_results/${docId}`);
              }
            }
          } catch (decodeErr) {
            // Skip records that aren't valid Entity protos
          }
        } catch (err) {
          // Skip malformed records
          break;
        }
      }

      // Clean up file
      fs.unlinkSync(localPath);
    }

    console.log(`\n📊 Extraction Complete:`);
    console.log(`  Total entities decoded: ${totalEntities}`);
    console.log(`  Unique collections found: ${kindsFound.size}`);
    console.log(`  Collections: ${Array.from(kindsFound).sort().join(', ')}`);
    console.log(`  race_results documents found: ${raceResults.length}\n`);

    if (raceResults.length === 0) {
      console.log('⚠️  No race_results documents found in backup.');
      console.log('   The backup may not contain race_results data.\n');
      return;
    }

    // Show sample
    console.log('📄 Sample documents:');
    raceResults.slice(0, 3).forEach(doc => {
      console.log(`  - ${doc.id}: ${JSON.stringify(doc.data).substring(0, 100)}...`);
    });
    console.log('');

    if (DRY_RUN) {
      console.log('⚠️  DRY RUN - Would restore these documents to Firestore.');
      console.log('   Run with --live to execute.\n');
      return;
    }

    // LIVE RESTORE
    console.log('🟢 Restoring to Firestore...\n');

    const batch = db.batch();
    let count = 0;

    for (const doc of raceResults) {
      const ref = db.collection('race_results').doc(doc.id);
      batch.set(ref, doc.data);
      count++;

      // Commit in batches of 500
      if (count % 500 === 0) {
        await batch.commit();
        console.log(`  Committed ${count} documents...`);
      }
    }

    // Commit remaining
    if (count % 500 !== 0) {
      await batch.commit();
    }

    console.log(`\n✅ Restore complete! ${raceResults.length} race_results documents restored.\n`);

    // Verify
    const verifySnapshot = await db.collection('race_results').get();
    console.log(`📊 Verification:`);
    console.log(`  race_results collection: ${verifySnapshot.size} documents\n`);

    // Clean up
    console.log('🧹 Cleaning up...');
    fs.rmdirSync(tempDir, { recursive: true });
    console.log('✓ Done\n');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    throw error;
  }
}

decodeAndRestore()
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error.message);
    process.exit(1);
  });
