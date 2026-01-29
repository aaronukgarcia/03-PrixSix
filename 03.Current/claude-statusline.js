// claude-statusline.js — Status line script
// Reads identity file + stdin JSON, outputs "name> [Model] dir"
const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  let name = '???';
  let model = 'Claude';
  let dir = '';

  try {
    const data = JSON.parse(input);
    model = data.model?.display_name || 'Claude';
    dir = path.basename(data.workspace?.current_dir || '');

    // Read identity from project .claude/.identity
    const projectDir = data.workspace?.project_dir || __dirname;
    const identityPath = path.join(projectDir, '.claude', '.identity');
    try {
      name = fs.readFileSync(identityPath, 'utf-8').trim();
    } catch {}
  } catch {}

  process.stdout.write(`${name}> [${model}] ${dir}`);
});
