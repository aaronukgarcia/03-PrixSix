# Garth's Credentials & Access

**⚠️ SENSITIVE INFORMATION - DO NOT COMMIT TO GIT ⚠️**

**Share this securely:** Use encrypted email, password manager share, or in-person transfer.

---

## 1. Firebase Admin Service Account

**File:** `service-account.json`

**Where to put it:**
```
E:\GoogleDrive\Papers\03-PrixSix\03.Current\service-account.json
```

**Contents:**
```json
{
  "type": "service_account",
  "project_id": "studio-6033436327-281b1",
  "private_key_id": "[GET FROM AARON]",
  "private_key": "[GET FROM AARON]",
  "client_email": "[GET FROM AARON]",
  "client_id": "[GET FROM AARON]",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "[GET FROM AARON]"
}
```

**⚠️ CRITICAL:**
- NEVER commit this file to git
- Check it's listed in `.gitignore`
- This gives FULL admin access to Firebase/Firestore

---

## 2. Environment Variables (`.env.local`)

**File:** `app/.env.local`

**Where to put it:**
```
E:\GoogleDrive\Papers\03-PrixSix\03.Current\app\.env.local
```

**Contents:**
```bash
# Firebase Client SDK (public - safe to share)
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyA23isMS-Jt60amqI-0XZHoMZeQOawtsSk
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=studio-6033436327-281b1.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=studio-6033436327-281b1
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=studio-6033436327-281b1.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=966261161276
NEXT_PUBLIC_FIREBASE_APP_ID=1:966261161276:web:4fcca2ea3728fb8448f239

# Microsoft Graph API (for email sending)
GRAPH_TENANT_ID=[GET FROM AARON]
GRAPH_CLIENT_ID=[GET FROM AARON]
GRAPH_CLIENT_SECRET=[GET FROM AARON]
GRAPH_SENDER_EMAIL=[GET FROM AARON]

# WhatsApp Worker Secret
WHATSAPP_APP_SECRET=[GET FROM AARON]

# OpenF1 API (sponsor tier)
OPENF1_USERNAME=[GET FROM AARON]
OPENF1_PASSWORD=[GET FROM AARON]
```

**⚠️ CRITICAL:**
- NEVER commit this file to git
- Check it's listed in `.gitignore`

---

## 3. Azure Access

### Azure Account
- **Email:** [GET FROM AARON]
- **Subscription:** Prix Six (UK South region)
- **Resource Group:** prixsix-resources

### Key Vault Access
- **Vault Name:** prixsix-secrets-vault
- **Location:** UK South
- **Access Level:** Reader + Secret User

### Setup Steps:
1. Aaron adds your account to the Azure subscription
2. You run: `az login`
3. Authenticate with your account
4. Test access: `az keyvault secret list --vault-name prixsix-secrets-vault`

### What's in Key Vault:
- `firebase-admin-key` - Firebase service account (JSON)
- `graph-client-secret` - Microsoft Graph API secret
- `whatsapp-app-secret` - WhatsApp worker authentication
- `openf1-username` - OpenF1 sponsor tier username
- `openf1-password` - OpenF1 sponsor tier password

---

## 4. GitHub Access

### Repository
- **URL:** https://github.com/aaronukgarcia/03-PrixSix
- **Your Role:** Collaborator (write access)

### Setup Steps:
1. Aaron invites you as collaborator
2. Accept the email invitation
3. Clone the repo: `git clone https://github.com/aaronukgarcia/03-PrixSix.git`

### Authentication Options:

**Option A: SSH Keys (Recommended)**
1. Generate key: `ssh-keygen -t ed25519 -C "your-email@example.com"`
2. Add to GitHub: Settings → SSH and GPG keys → New SSH key
3. Clone with: `git@github.com:aaronukgarcia/03-PrixSix.git`

**Option B: Personal Access Token**
1. GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Generate new token with `repo` scope
3. Use token as password when git prompts

---

## 5. Firebase CLI Authentication

### Login Command:
```bash
firebase login
```

This opens browser for Google authentication.

### Verify Access:
```bash
firebase projects:list
# Should show: studio-6033436327-281b1

firebase apphosting:backends:list
# Should show: prixsix backend
```

---

## 6. Vestige MCP (Memory System)

### Location:
- **Path:** `E:\GoogleDrive\Tools\Memory\source\vestige-mcp-v1.1.2.exe`
- **Memory Storage:** `C:\Users\YourName\.claude\projects\E--GoogleDrive-Tools-Memory-source\memory\`

### Setup Command:
```bash
claude mcp add -s user vestige "E:\GoogleDrive\Tools\Memory\source\vestige-mcp-v1.1.2.exe"
```

**Note:** Path might be different on your machine - ask Aaron.

---

## 7. OpenF1 API (Optional - for reference)

### Account Details
- **Website:** https://openf1.org/
- **Tier:** Sponsor (€9.90/month)
- **Username:** [STORED IN AZURE KEY VAULT]
- **Password:** [STORED IN AZURE KEY VAULT]
- **Rate Limit:** 6 req/sec, 60 req/min

**You don't need direct access** - credentials are loaded automatically from Azure Key Vault when deployed.

---

## 8. System Environment Variable

### Required Variable:
- **Name:** `ENABLE_TOOL_SEARCH`
- **Value:** `true`
- **Scope:** User (not System)

### How to Set (Windows):
1. Search "Environment Variables" in Start Menu
2. Click "Environment Variables..." button
3. Under "User variables", click "New..."
4. Name: `ENABLE_TOOL_SEARCH`
5. Value: `true`
6. OK → OK → Restart Claude Code

This enables Claude Code to load MCP tools dynamically.

---

## 9. Claude Code Identity

When working on Prix Six, use the name **"garth"** so the session tracking works.

Tell Claude at the start of each session:
> "This is Garth. Check in and load the Golden Rules."

Claude will respond with your identity prefix:
```
garth> Checked in. Loading Golden Rules...
```

---

## Security Checklist ✅

Before you start working, verify:

- [ ] `service-account.json` is in project root (NOT in git)
- [ ] `app/.env.local` exists with all values filled in (NOT in git)
- [ ] `.gitignore` includes both files above
- [ ] `az login` works (Azure CLI authenticated)
- [ ] `firebase login` works (Firebase CLI authenticated)
- [ ] `git clone` works (GitHub access granted)
- [ ] `claude --version` works (Claude Code installed)
- [ ] `ENABLE_TOOL_SEARCH=true` environment variable set
- [ ] Vestige MCP configured: `claude mcp list` shows vestige

---

## Test Everything

Run this test checklist:

```bash
# 1. Git access
git clone https://github.com/aaronukgarcia/03-PrixSix.git
cd 03-PrixSix/03.Current

# 2. Firebase access
firebase projects:list

# 3. Azure access
az keyvault secret list --vault-name prixsix-secrets-vault

# 4. Dependencies
cd app
npm install

# 5. Claude Code
cd ..
claude
```

Then in Claude:
> "This is Garth. Check in and show me the project status."

If all of this works, you're ready! 🚀

---

## Who to Contact

- **General questions:** Aaron
- **Access issues:** Aaron
- **"Is this normal?" questions:** Aaron
- **Emergency/urgent:** Aaron (call/text)

---

**Last Updated:** 2026-02-18
**For:** Garth (onboarding)
**By:** Aaron

**⚠️ KEEP THIS FILE SECURE - DELETE AFTER SETUP IF NEEDED ⚠️**
