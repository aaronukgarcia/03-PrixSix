# Garth's Quick Start Checklist ✅

Use this checklist to get up and running. Full details in `GARTH-ONBOARDING.md`.

---

## Pre-Work (Do Once)

### Software Installation
- [ ] **Node.js LTS** from https://nodejs.org/ → verify: `node --version`
- [ ] **Git** from https://git-scm.com/ → verify: `git --version`
- [ ] **Claude Code** from https://claude.com/claude-code → verify: `claude --version`
- [ ] **VS Code** (optional) from https://code.visualstudio.com/
- [ ] **Firebase CLI**: `npm install -g firebase-tools` → verify: `firebase --version`

### Environment Setup (Windows)
- [ ] Add User environment variable: `ENABLE_TOOL_SEARCH=true`
- [ ] Restart Claude Code after setting env var

### Get From Aaron
- [ ] `service-account.json` (Firebase admin key) → save to project root
- [ ] `.env.local` values (copy from `.env.local.example` and fill in)
- [ ] Azure subscription access (for Key Vault)
- [ ] GitHub collaborator access
- [ ] Vestige MCP path for your machine

### Clone & Setup
```bash
# Clone repository
git clone https://github.com/aaronukgarcia/03-PrixSix.git
cd 03-PrixSix/03.Current

# Install dependencies
cd app
npm install
cd ..

# Set up MCP (ask Aaron for correct path)
claude mcp add -s user vestige "E:\GoogleDrive\Tools\Memory\source\vestige-mcp-v1.1.2.exe"

# Verify everything works
node claude-sync.js read
```

---

## Every Session (Do Each Time)

### 1. Start
```bash
cd E:\GoogleDrive\Papers\03-PrixSix\03.Current
claude
```

### 2. Tell Claude
> "This is Garth. Check in and load the Golden Rules."

### 3. Work on Tasks
Examples:
- "Show me what's in the Book of Work"
- "Fix bug [description]"
- "Add feature [description]"

### 4. Before Finishing
Claude will show **completion verification checklist**:
- File paths with line numbers
- Code snippets as proof
- All dependencies verified

### 5. End Session
> "Commit the changes and check out"

---

## Golden Rules Quick Reference

Tell Claude about these at the start of every session:

1. **Error Trapping** - 4 pillars: log, type, correlation ID, selectable display
2. **Version Discipline** - Bump package.json every commit
3. **Single Source** - No duplication without validation
4. **Identity Prefix** - Every response starts with `garth>` (your name)
5. **Verbose Confirms** - Explicit, timestamped, version-numbered
6. **GUID Docs** - Read before change, update version + code.json
7. **Registry Errors** - Use ERRORS.KEY from error-registry.ts
8. **Prompt Identity** - "who" check, log violations
9. **Shell Preference** - PowerShell → CMD → bash
10. **Dependency Check** - Check updates on ALL deps during bugs
11. **Security Review** - 5 questions before EVERY commit
12. **Completeness** - Verify ALL dependencies before "done"
13. **Complete ALL** - Fix ALL identified issues (no TODO)

Full version: `golden-rules-reminder.md`

---

## Common Commands

### Session Management
```bash
node claude-sync.js checkin    # Start session
node claude-sync.js checkout   # End session
node claude-sync.js read       # Who's working?
node claude-sync.js gc         # Clean stale sessions
```

### Git
```bash
git status                     # What changed?
git log --oneline -10          # Recent commits
git pull origin main           # Get latest
git push origin main           # Push changes
```

### Development
```bash
cd app
npm run dev                    # Run locally (port 9002)
npm run build                  # Build for production
npm run lint                   # Check code quality
```

### Deployment
```bash
cd app
firebase apphosting:rollouts:create prixsix -b main -f
```

---

## Emergency Recovery

### "Can't check in"
```bash
node claude-sync.js gc
```

### "Git conflicts"
```bash
git status
git pull origin main
# Fix conflicts, then:
git add .
git commit -m "Resolve conflicts"
git push origin main
```

### "Claude confused"
> "Let's start fresh. Load the Golden Rules and show me the project status."

### "Deployment failed"
1. Check Firebase Console logs
2. Check secrets: `firebase apphosting:secrets:list`
3. Ask Aaron

---

## Key Files

- `CLAUDE.md` - Full project docs
- `golden-rules-reminder.md` - The 13 rules
- `code.json` - GUID tracking (1,005 blocks)
- `book-of-work.json` - Known bugs
- `app/package.json` - Version number (bump every commit!)
- `app/apphosting.yaml` - Deployment config

---

## NEVER Commit These Files

- `.env.local`
- `service-account.json`
- Any file with passwords/keys

Check `.gitignore` includes them!

---

## First Time Only

After setup, test everything:

> "This is Garth. I'm checking in for the first time. Can you verify all tools are working and show me the Prix Six status?"

If Claude responds with your name prefix (`garth>`) and loads the rules, you're good to go! 🚀

---

**Need help?** Read `GARTH-ONBOARDING.md` or ask Aaron
