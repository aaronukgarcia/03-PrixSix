# Aaron's TODO: Onboard Garth

This checklist tells you exactly what you need to do to get Garth set up with Prix Six development.

---

## Files Created for Garth

✅ **GARTH-ONBOARDING.md** - Complete onboarding guide (friendly, non-technical)
✅ **GARTH-QUICK-START.md** - Quick reference checklist
✅ **GARTH-CREDENTIALS-TEMPLATE.md** - Template for credentials you need to fill in

---

## Your Action Items

### 1. Share the Onboarding Docs
- [ ] Email or share `GARTH-ONBOARDING.md` with Garth
- [ ] Email or share `GARTH-QUICK-START.md` with Garth

These are safe to share - no secrets in them.

---

### 2. Grant Access

#### GitHub
- [ ] Go to: https://github.com/aaronukgarcia/03-PrixSix/settings/access
- [ ] Click "Invite a collaborator"
- [ ] Enter Garth's GitHub username or email
- [ ] Select "Write" access
- [ ] Send invitation

#### Azure
- [ ] Go to: https://portal.azure.com
- [ ] Navigate to Subscription → IAM → Add role assignment
- [ ] Role: "Reader"
- [ ] Assign to: Garth's Microsoft account
- [ ] Save
- [ ] Navigate to `prixsix-secrets-vault` → Access policies
- [ ] Add access policy:
  - Secret permissions: Get, List
  - Select principal: Garth's account
  - Save

#### Firebase
- [ ] Go to: https://console.firebase.google.com/project/studio-6033436327-281b1/settings/iam
- [ ] Add member: Garth's Google account
- [ ] Role: "Firebase Admin" (or "Editor" if you want to be more restrictive)
- [ ] Save

---

### 3. Create Credentials File for Garth

Copy `GARTH-CREDENTIALS-TEMPLATE.md` and fill in the blanks:

#### Firebase Service Account
Location: `E:\GoogleDrive\Papers\03-PrixSix\03.Current\service-account.json`

Option A: Share the entire file securely
Option B: Fill in template with values from the file

#### Environment Variables
Location: `E:\GoogleDrive\Papers\03-PrixSix\03.Current\app\.env.local`

Copy your `.env.local` and share it with Garth securely (it contains secrets).

Values he needs:
```bash
GRAPH_TENANT_ID=<from your .env.local>
GRAPH_CLIENT_ID=<from your .env.local>
GRAPH_CLIENT_SECRET=<from your .env.local>
GRAPH_SENDER_EMAIL=<from your .env.local>
WHATSAPP_APP_SECRET=<from your .env.local>
OPENF1_USERNAME=<from your .env.local>
OPENF1_PASSWORD=<from your .env.local>
```

#### Vestige MCP Path
Garth will need Vestige installed on his machine. Options:

**Option A: Copy your Vestige executable**
- Your path: `E:\GoogleDrive\Tools\Memory\source\vestige-mcp-v1.1.2.exe`
- Share this file with Garth
- He installs it to the same path on his machine

**Option B: Download from source**
- If you have the Vestige installer, share it
- Garth installs to a path of his choice
- Update the MCP config command with his path

---

### 4. Secure Sharing Method

**DO NOT EMAIL RAW CREDENTIALS!**

Use one of these secure methods:

#### Option A: 1Password/LastPass/Bitwarden (Recommended)
1. Create a new secure note with all credentials
2. Share the note with Garth
3. He imports into his own password manager

#### Option B: Encrypted Email
1. Use ProtonMail or similar encrypted email
2. Send credentials in encrypted message
3. Share decryption password via different channel (phone/text)

#### Option C: In-Person
1. Meet with Garth
2. Copy files to his laptop via USB drive
3. Verify setup works together

#### Option D: Encrypted File Share
1. Use 7-Zip with strong password
2. Upload to Google Drive (private link)
3. Share password via phone/text

---

### 5. Verification Steps (Do With Garth)

Once Garth has everything, help him verify:

#### Test 1: Git Access
```bash
git clone https://github.com/aaronukgarcia/03-PrixSix.git
```
Should work without errors.

#### Test 2: Firebase CLI
```bash
firebase login
firebase projects:list
```
Should show "studio-6033436327-281b1".

#### Test 3: Azure CLI
```bash
az login
az keyvault secret list --vault-name prixsix-secrets-vault
```
Should list 5 secrets.

#### Test 4: Claude Code + Vestige
```bash
claude
```
Tell Claude:
> "This is Garth. Check in and show me the project status."

Should respond with `garth>` prefix and load Golden Rules.

#### Test 5: Full Build
```bash
cd 03-PrixSix/03.Current/app
npm install
npm run build
```
Should build successfully.

---

### 6. First Pairing Session (Recommended)

Schedule 30-60 minutes to:
- [ ] Walk through the codebase structure
- [ ] Show him how to use Claude Code effectively
- [ ] Do a small task together (fix a simple bug)
- [ ] Demonstrate check-in/checkout workflow
- [ ] Show him the Golden Rules in practice
- [ ] Explain the Book of Work system

---

### 7. Update Session Coordination

Add Garth to the session coordination system:

Edit `claude-sync.js` if needed (it should auto-detect, but verify).

Test:
```bash
node claude-sync.js checkin
node claude-sync.js read
# Should show Garth's session
node claude-sync.js checkout
```

---

## What Garth Should Know Before Starting

### Core Concepts
1. **Golden Rules** - 13 rules that Claude enforces
2. **Session Coordination** - Check in/out to avoid conflicts
3. **Version Discipline** - Bump package.json every commit
4. **Completion Verification** - Evidence checklist before "done"
5. **Memory System** - Vestige stores patterns and knowledge

### Workflow
1. Check in → Load rules
2. Do work
3. Show completion checklist
4. Commit + bump version
5. Check out

### Common Gotchas
- Don't commit `.env.local` or `service-account.json`
- Always check in before starting work
- Always check out when done
- Version number must increment every commit
- Claude needs clear, specific instructions

---

## If Something Goes Wrong

### "Garth can't access GitHub"
1. Check invitation was sent and accepted
2. Check permissions are "Write" not "Read"
3. Try SSH key setup instead of HTTPS

### "Garth can't access Azure"
1. Verify email matches his Microsoft account
2. Check role assignment saved
3. Try `az login` and verify logged in as correct account

### "Garth can't access Firebase"
1. Check invitation sent to correct email
2. Verify role is "Firebase Admin" or "Editor"
3. Try `firebase logout` then `firebase login` again

### "Vestige not working"
1. Check MCP config: `claude mcp list`
2. Verify Vestige executable exists at specified path
3. Check `ENABLE_TOOL_SEARCH=true` environment variable set
4. Restart Claude Code after setting env var

### "Claude won't check in"
```bash
node claude-sync.js gc    # Clean stale sessions
node claude-sync.js read  # Verify Firestore connection
```

---

## Post-Onboarding

After Garth completes his first few tasks:

- [ ] Add him to any relevant Slack/Discord channels
- [ ] Share the deployment schedule (when we release)
- [ ] Explain the Book of Work triage process
- [ ] Show him how to query Vestige for patterns
- [ ] Give him access to Firebase Console (if needed)
- [ ] Add him to Azure cost alerts (if you want)

---

## Security Reminders for Garth

Make sure he knows:
- ✅ `.gitignore` prevents committing secrets
- ✅ Never `git add .` without checking `git status` first
- ✅ Never share credentials in Slack/Discord/public channels
- ✅ Use Azure Key Vault for new secrets (don't hardcode)
- ✅ If he accidentally commits a secret → rotate it immediately

---

## Estimated Time Investment

- **Your time:** 1-2 hours total
  - 30 min: Grant access + create credentials file
  - 30 min: Help with initial setup verification
  - 30-60 min: First pairing session (optional but recommended)

- **Garth's time:** 2-4 hours
  - 1 hour: Install prerequisites
  - 30 min: Clone repo + setup credentials
  - 30 min: Test everything works
  - 1-2 hours: Read docs + understand workflow

---

## Success Criteria

Garth is ready when he can:
- ✅ Check in / check out successfully
- ✅ Make a commit with version bump
- ✅ Deploy to Firebase App Hosting
- ✅ Ask Claude to fix a bug and understand the output
- ✅ Explain the 13 Golden Rules
- ✅ Know when to ask for help

---

**Next Steps:**
1. Grant access (GitHub, Azure, Firebase)
2. Create filled-in credentials file
3. Share securely with Garth
4. Schedule first pairing session
5. Watch him do his first check-in

Good luck! 🚀
