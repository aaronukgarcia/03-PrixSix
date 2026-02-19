# Welcome to Prix Six Development, Garth! 🏎️

Hi Garth! Welcome to the team. This guide will help you get set up with Claude Code so you can start helping with Prix Six development. Don't worry if you're new to this - we'll walk through everything step by step.

---

## What You're Joining

Prix Six is an F1 prediction game where users predict race results and compete in leagues. You'll be working with Claude Code, an AI assistant that helps write code, fix bugs, and build new features. Think of it like having an expert developer as your pair programming partner.

---

## Prerequisites - What You Need to Install First

### 1. **Node.js** (JavaScript runtime)
- Download from: https://nodejs.org/
- Get the **LTS version** (currently v24.13.0 or newer)
- This lets you run JavaScript code on your computer
- After installing, verify in terminal: `node --version`

### 2. **Git** (Version control)
- Download from: https://git-scm.com/
- This tracks changes to code and lets multiple people work together
- After installing, verify: `git --version`

### 3. **Claude Code CLI** (The AI assistant)
- Install from: https://claude.com/claude-code
- Follow the installation wizard
- You'll need a Claude account (create one if you don't have it)
- After installing, verify: `claude --version`

### 4. **A Code Editor** (Optional but recommended)
- **VS Code** is easiest: https://code.visualstudio.com/
- You can use any text editor, but VS Code has nice features

### 5. **Firebase CLI** (For deployments)
- After Node.js is installed, run: `npm install -g firebase-tools`
- This lets you deploy updates to the live website
- Verify: `firebase --version`

### 6. **Windows Users Only:**
- Make sure Git Bash is installed (comes with Git)
- Claude Code uses bash scripts, which work through Git Bash on Windows

---

## Getting the Prix Six Code

1. **Clone the repository:**
   ```bash
   git clone https://github.com/aaronukgarcia/03-PrixSix.git
   cd 03-PrixSix/03.Current
   ```

2. **Install dependencies:**
   ```bash
   cd app
   npm install
   ```
   (This downloads all the code libraries Prix Six needs)

3. **Set up environment variables:**
   - Copy `.env.local.example` to `.env.local`
   - Ask Aaron for the actual values to fill in
   - NEVER commit `.env.local` to git (it contains secrets)

---

## Setting Up Claude Code

### 1. **Configure MCP Servers** (Memory & Tools)

Claude Code uses "MCP servers" which give it superpowers like long-term memory. Run this command to add the memory system:

```bash
claude mcp add -s user vestige "E:\GoogleDrive\Tools\Memory\source\vestige-mcp-v1.1.2.exe"
```

**Important:** Ask Aaron for the correct path to the Vestige memory system on your computer.

### 2. **Set Required Environment Variable**

On Windows (search for "Environment Variables" in Start Menu):
- Add a new **User** variable:
  - Name: `ENABLE_TOOL_SEARCH`
  - Value: `true`
- Restart Claude Code after setting this

This enables Claude Code to load MCP tools dynamically.

---

## Understanding Memory (CRITICAL!)

Claude Code has a **long-term memory system** called Vestige. This is stored at:
```
C:\Users\YourName\.claude\projects\E--GoogleDrive-Tools-Memory-source\memory\MEMORY.md
```

### What is MEMORY.md?

Think of it as Claude's "brain" - it contains:
- **Golden Rules** - 13 inviolable rules for Prix Six development
- **Common patterns** - Security best practices, error handling, etc.
- **Recent sessions** - What work has been done recently
- **Project quick links** - Important files and commands

### Why This Matters

Every time you start working with Claude Code on Prix Six:

1. **Claude automatically reads MEMORY.md** when it starts
2. This loads the Golden Rules and patterns into its "active memory"
3. You can query deeper knowledge with: `mcp__vestige__search`

### Keeping Memory Updated

- Memory gets updated automatically as you work
- If Claude learns something important, it saves it to Vestige
- Memory naturally decays over time (uses spaced repetition)
- Keep MEMORY.md under 200 lines (it's just an index, details live in Vestige)

---

## The 13 Golden Rules (Prix Six Specific)

**CRITICAL:** At the start of EVERY session working on Prix Six, tell Claude Code:

> "Check in and load the Golden Rules"

This triggers Claude to read `golden-rules-reminder.md` which contains:

| # | Rule | What It Means |
|---|------|---------------|
| 1 | **Error Trapping** | Every error needs: error log, error type/code, correlation ID, selectable display |
| 2 | **Version Discipline** | Bump version in package.json every commit, verify after push |
| 3 | **Single Source** | Don't duplicate logic - if code exists, reuse it |
| 4 | **Identity Prefix** | Every Claude response starts with a name (bob>, bill>, ben>) |
| 5 | **Verbose Confirms** | Explicit confirmations with timestamps and version numbers |
| 6 | **GUID Docs** | Read GUID comments before changing code, update version after |
| 7 | **Registry Errors** | Use error codes from error-registry.ts only |
| 8 | **Prompt Identity** | Claude checks "who am I?" and logs violations |
| 9 | **Shell Preference** | PowerShell → CMD → bash (last resort on Windows) |
| 10 | **Dependency Check** | Check for updates on ALL dependencies when fixing bugs |
| 11 | **Security Review** | Answer 5 security questions before EVERY commit |
| 12 | **Completeness** | Verify ALL dependencies before claiming "done" |
| 13 | **Complete ALL** | Fix ALL user-identified issues (no "TODO" comments) |

**Read the full rules:** `E:\GoogleDrive\Papers\03-PrixSix\03.Current\golden-rules-reminder.md`

---

## Session Coordination (Multi-Claude Instances)

Prix Six uses a **session coordination system** because multiple Claude instances might work on the code:

### The Three Claudes

- **bob** - General development and bug fixes
- **bill** - Specialized in security and infrastructure
- **ben** - UI/UX and user-facing features

### Check In/Out Protocol

**Before starting work:**
```bash
node claude-sync.js checkin
```

This:
- Registers your session in Firestore
- Claims you're actively working
- Prevents conflicts with other Claude instances

**When you're done:**
```bash
node claude-sync.js checkout
```

**To see who's working:**
```bash
node claude-sync.js read
```

### Why This Matters

Without check-in:
- Two Claudes might edit the same file
- Merge conflicts happen
- Work gets lost

With check-in:
- You know if someone else is working
- You can coordinate who does what
- No accidental overwrites

---

## Where to Get Credentials

You'll need access to various services. Ask Aaron for:

### 1. **Firebase (Database & Hosting)**
- Firebase Admin service account key
- Location: Aaron will share `service-account.json`
- Put it in: `E:\GoogleDrive\Papers\03-PrixSix\03.Current\service-account.json`
- **NEVER commit this file to git!**

### 2. **Azure Key Vault** (Secret storage)
- Azure account: Aaron will add you to the subscription
- Key vault: `prixsix-secrets-vault` in UK South
- After added, run: `az login` to authenticate

### 3. **OpenF1 API** (F1 timing data)
- Sponsor tier subscription (€9.90/month)
- Credentials are in Azure Key Vault
- You don't need direct access - they're loaded automatically

### 4. **Microsoft Graph API** (Email sending)
- Used for sending welcome emails, results emails
- Credentials in Azure Key Vault
- Ask Aaron if you need to test email features

### 5. **GitHub** (Code repository)
- GitHub account
- Aaron will add you as a collaborator to the repo
- Set up SSH keys or personal access token

---

## Your First Session - Step by Step

### 1. **Start Claude Code**
```bash
cd E:\GoogleDrive\Papers\03-PrixSix\03.Current
claude
```

### 2. **Check In**
Tell Claude:
> "Check in and load the Golden Rules"

Claude will run `node claude-sync.js checkin` and read `golden-rules-reminder.md`.

### 3. **Check What's Happening**
Tell Claude:
> "Show me the current status - git status, recent commits, and what's in the Book of Work"

This gives you context on what's been worked on recently.

### 4. **Do Your Work**
Example tasks you might do:
- "Fix the bug where users can't submit predictions"
- "Add a new email template for league invitations"
- "Update the standings page to show team logos"

### 5. **Before Saying You're Done**
Claude will show you a **completion verification checklist** with:
- ✓ File paths with line numbers
- ✓ Actual code snippets as proof
- ✓ All dependencies verified

This ensures nothing is forgotten.

### 6. **Check Out**
Tell Claude:
> "Commit the changes and check out"

Claude will:
- Create a git commit with proper message
- Bump the version number
- Push to GitHub
- Run checkout to release the session

---

## Common Commands You'll Use

### Git Commands
```bash
git status              # See what files changed
git log --oneline -10   # See recent commits
git pull origin main    # Get latest changes
git push origin main    # Push your changes
```

### Firebase Commands
```bash
firebase apphosting:rollouts:create prixsix -b main -f   # Deploy to production
firebase apphosting:secrets:list                         # List secrets
```

### Development Commands
```bash
cd app
npm run dev             # Run development server (localhost:9002)
npm run build           # Build for production
npm run lint            # Check code quality
```

### Session Coordination
```bash
node claude-sync.js checkin   # Start session
node claude-sync.js checkout  # End session
node claude-sync.js read      # See who's working
node claude-sync.js ping      # Update your heartbeat
```

---

## Key Files to Know About

### Project Root
- `CLAUDE.md` - Full project documentation for Claude
- `golden-rules-reminder.md` - The 13 Golden Rules
- `claude-sync.js` - Session coordination script
- `code.json` - GUID tracking system (1,005 tracked code blocks)
- `book-of-work.json` - Known bugs and pending features

### App Directory (`app/`)
- `package.json` - Version number (bump this every commit!)
- `apphosting.yaml` - Firebase deployment config
- `.env.local` - Local environment variables (NOT in git)

### Source Code (`app/src/`)
- `app/(app)/admin/` - Admin panel components
- `app/api/` - API endpoints
- `lib/` - Shared utilities (firebase, errors, etc.)
- `components/` - Reusable UI components

---

## What to Do When Things Go Wrong

### "Claude won't check in"
```bash
node claude-sync.js gc    # Garbage collect stale sessions
```

### "Deployment failed"
1. Check the error message in Firebase Console
2. Check if secrets are configured: `firebase apphosting:secrets:list`
3. Look at build logs (link provided in error)

### "Git conflicts"
```bash
git status                # See conflicted files
git pull origin main      # Get latest
# Fix conflicts manually, then:
git add .
git commit -m "Resolve merge conflicts"
git push origin main
```

### "Claude seems confused"
Tell Claude:
> "Let's start fresh. Check the golden rules and show me the current state of the project."

### "I don't understand what Claude is doing"
Ask:
> "Can you explain what you just did in simple terms?"

Claude should explain clearly - you're in charge!

---

## Security & Best Practices

### 1. **NEVER Commit Secrets**
Files to NEVER commit:
- `.env.local`
- `service-account.json`
- Any file with passwords, API keys, or tokens

Check `.gitignore` has these listed.

### 2. **Always Use Branches for Risky Work**
```bash
git checkout -b garth-testing-feature
# Do your work
# If it works, merge to main
# If it breaks, just delete the branch
```

### 3. **Test Before Deploying**
```bash
npm run dev    # Test locally at localhost:9002
npm run build  # Make sure it builds
# Then deploy to production
```

### 4. **Ask Before Destructive Actions**
If Claude wants to:
- Delete files
- Force push
- Drop database tables
- Reset git history

Ask Claude to explain why first!

---

## Getting Help

### From Claude Code
Ask questions like:
- "How does the prediction submission system work?"
- "Where is the error handling code?"
- "Show me recent changes to the standings page"

### From Aaron
- Credentials and access
- Architectural decisions
- "Why did we build it this way?"

### From Vestige (Memory)
Claude can query its memory:
```
mcp__vestige__search with query: "security patterns"
mcp__vestige__search with query: "error handling"
```

---

## Quick Reference Card

Print this or keep it handy:

```
START SESSION:
1. cd E:\GoogleDrive\Papers\03-PrixSix\03.Current
2. claude
3. "Check in and load the Golden Rules"

DURING SESSION:
- Claude's name: bob/bill/ben (starts every response)
- Version bump: Every commit
- Completion hook: Always shows evidence checklist
- Security check: 5 questions before commit

END SESSION:
1. "Commit and check out"
2. Verify version bumped
3. Check deployment succeeded

EMERGENCY:
- node claude-sync.js gc    (clean stale sessions)
- git status                (what changed?)
- npm run build             (does it build?)
- Ask Aaron!
```

---

## You're Ready! 🚀

That's it! You now know:
- ✅ What to install
- ✅ How to set up Claude Code
- ✅ What the Golden Rules are
- ✅ How to check in/out
- ✅ Where to get credentials
- ✅ How to do your first session

**Your first task:** Set up your environment, install everything, and do a test check-in. Tell Claude:

> "This is Garth. I'm checking in for the first time. Can you verify all the tools are working and show me the current status of Prix Six?"

Welcome to the team! 🏎️💨

---

**Questions?** Ask Aaron or tell Claude "I'm stuck on [specific issue]"
