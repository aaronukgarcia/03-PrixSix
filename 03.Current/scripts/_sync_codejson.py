# GUID: SCRIPT-CODEJSON-001-v01
# [Type] Utility Script — outside production build, used in development and testing
# [Category] CodeJson
# [Intent] Python utility to sync code.json entries with the live filesystem — reports orphan files and undocumented exports.
# [Usage] python scripts/_sync_codejson.py (run from project root)
# [Moved] 2026-02-24 from project root — codebase tidy-up
#
import json, os, re
from collections import Counter

codejson_path = 'E:/GoogleDrive/Papers/03-PrixSix/03.Current/code.json'
base_path = 'E:/GoogleDrive/Papers/03-PrixSix/03.Current'

with open(codejson_path, 'r') as f:
    data = json.load(f)

# Build lookup of existing GUIDs
existing = {e['guid']: i for i, e in enumerate(data['guids'])}

# Scan ALL source files for versioned GUIDs
source_guids = {}  # guid -> {ver, file, desc, func, cat}

for root_dir in [os.path.join(base_path, 'app/src'), os.path.join(base_path, 'functions')]:
    for dirpath, dirnames, filenames in os.walk(root_dir):
        for fname in filenames:
            if fname.endswith(('.ts', '.tsx', '.js', '.jsx')):
                fpath = os.path.join(dirpath, fname)
                rel_path = fpath.replace(base_path + os.sep, '').replace(os.sep, '/')
                try:
                    with open(fpath, 'r', encoding='utf-8', errors='ignore') as f2:
                        lines = f2.readlines()
                    
                    for i, line in enumerate(lines):
                        m = re.match(r'\s*// GUID:\s+(\S+)-(\d{3})([A-Z]?)-v(\d+)', line)
                        if m:
                            prefix = m.group(1)
                            seq = m.group(2)
                            suffix = m.group(3)
                            ver = int(m.group(4))
                            base_guid = f'{prefix}-{seq}'
                            
                            # Extract description
                            desc = ''
                            func_name = ''
                            j = i + 1
                            while j < len(lines):
                                cline = lines[j].strip()
                                if not cline.startswith('//'):
                                    fn_m = re.match(r'(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|class|interface|type|enum)\s+(\w+)', cline)
                                    if fn_m:
                                        func_name = fn_m.group(1)
                                    break
                                comment = cline.lstrip('/ ').strip()
                                if comment.startswith('[Intent]'):
                                    desc = comment[8:].strip()
                                elif desc and not comment.startswith('['):
                                    desc += ' ' + comment
                                j += 1
                            
                            if not desc:
                                desc = f'{prefix} code block {base_guid}'
                            
                            # Logic category
                            cat = 'ORCHESTRATION'
                            dl = desc.lower()
                            if any(w in dl for w in ['type def', 'interface ', 'schema', 'definition', 'regex', 'enum ']):
                                cat = 'VALIDATION'
                            elif any(w in dl for w in ['transform', 'convert', 'format', 'parse', 'calculat', 'build', 'extract', 'normaliz', 'generat']):
                                cat = 'TRANSFORMATION'
                            elif any(w in dl for w in ['render', 'display', 'card', 'button', 'ui ', 'badge', 'icon', 'visual', 'component that']):
                                cat = 'PRESENTATION'
                            elif any(w in dl for w in ['constant', 'config', 'mapping', 'lookup', 'label', 'preset']):
                                cat = 'DATA'
                            
                            if base_guid not in source_guids or ver > source_guids[base_guid]['ver']:
                                source_guids[base_guid] = {
                                    'ver': ver,
                                    'file': rel_path,
                                    'desc': desc,
                                    'func': func_name,
                                    'cat': cat,
                                }
                except:
                    pass

# Also scan for unversioned GUIDs (old format)
unversioned_guids = set()
for root_dir in [os.path.join(base_path, 'app/src'), os.path.join(base_path, 'functions')]:
    for dirpath, dirnames, filenames in os.walk(root_dir):
        for fname in filenames:
            if fname.endswith(('.ts', '.tsx', '.js', '.jsx')):
                fpath = os.path.join(dirpath, fname)
                try:
                    with open(fpath, 'r', encoding='utf-8', errors='ignore') as f2:
                        for line in f2:
                            # Match unversioned: // GUID: PREFIX-NNN (no -vNN)
                            m = re.match(r'\s*// GUID:\s+(\S+-\d{3})\s*$', line)
                            if m:
                                unversioned_guids.add(m.group(1))
                except:
                    pass

print(f'Source: {len(source_guids)} versioned GUIDs, {len(unversioned_guids)} unversioned GUIDs')

# STEP 1: Add missing GUIDs to code.json
added = 0
for guid, info in sorted(source_guids.items()):
    if guid not in existing:
        location = {'filePath': info['file']}
        if info['func']:
            location['functionName'] = info['func']
        entry = {
            'guid': guid,
            'version': info['ver'],
            'logic_category': info['cat'],
            'description': info['desc'],
            'dependencies': [],
            'location': location,
            'callChain': {'calledBy': [], 'calls': []}
        }
        data['guids'].append(entry)
        existing[guid] = len(data['guids']) - 1
        added += 1

print(f'STEP 1: Added {added} missing GUIDs')

# STEP 2: Fix version mismatches
ver_fixed = 0
for guid, info in source_guids.items():
    if guid in existing:
        idx = existing[guid]
        if data['guids'][idx]['version'] < info['ver']:
            data['guids'][idx]['version'] = info['ver']
            ver_fixed += 1

print(f'STEP 2: Fixed {ver_fixed} version mismatches')

# STEP 3: Remove phantom GUIDs (in code.json but not in source, and not unversioned)
# Protect PAGE_ONBOARDING and COMPONENT_WELCOME_CTA since they use unversioned format
protected_prefixes = set()
for g in unversioned_guids:
    prefix = g.rsplit('-', 1)[0]
    protected_prefixes.add(prefix)

phantoms = []
for entry in data['guids']:
    guid = entry['guid']
    prefix = guid.rsplit('-', 1)[0]
    if guid not in source_guids and prefix not in protected_prefixes:
        phantoms.append(guid)

# Actually remove them
before = len(data['guids'])
data['guids'] = [e for e in data['guids'] if e['guid'] not in set(phantoms)]
removed = before - len(data['guids'])
print(f'STEP 3: Removed {removed} phantom GUIDs')

if phantoms:
    # Group by prefix for reporting
    phantom_prefixes = Counter()
    for g in phantoms:
        phantom_prefixes[g.rsplit('-', 1)[0]] += 1
    for p, c in sorted(phantom_prefixes.items()):
        print(f'  {p}: -{c}')

# Sort and update total
data['
