# Prix Six - Claude Code Instructions

## Keep up
- when ever you compact the coversation you must read this file and inform the users your caught up with the instructions.
- before starting work check the consitency checker (CC) and note how it checks all IDs and cases plan for anything you build to be chcked by the CC.
- add to the CC any new tables which have ID's and look ups.


## Environment
- Platform: Windows
- Node: C:\Program Files\nodejs\node.exe
- NPM: C:\Program Files\nodejs\npm.cmd
- Project root: E:\GoogleDrive\Papers\03-PrixSix\03.Current
- Firebase service account: E:\GoogleDrive\Papers\03-PrixSix\03.Current\service-account.json

## Git Discipline
- **Always** check `git status` and current branch before starting work (another Claude Code instance may be active)
- **Always** bump the version in package.json when making changes
- Commit atomically with clear messages
- always ensure the page https://prixsix--studio-6033436327-281b1.europe-west4.hosted.app/about has the updated version number too.


## Terminal Clarification
- "Console" means PowerShell or CMD
- "Firebase" refers to the GUI unless explicitly using Firebase CLI or the SDK

## Error Handling Standards
- Always wrap operations in try/catch
- Generate unique `error_correlation_id` (UUID) for every error
- Log full error details including:
  - Correlation ID
  - Stack trace
  - Browser/client info where possible (page URL, user agent)
  - Timestamp (ISO 8601)
- Copy raw error object to error log

## Code Standards
- Prefer JSON for data interchange
- Firebase hosting

## Project Context
Prix Six is a fantasy Formula 1 league management system.

## Types of Data
Standing data is the tracks and the drivers
Temp data is teams and submissions (predictions) 
two entries of temp data must not be tocuhed unless asked for 
1. aaron@garcia.ltd - admin
2. aaron.garcia@hotmail.co.uk user

## Check the case
a common fault is match and data store with lowercase ID e.g. (australian-grand-prix), but these can be stored with mixed case (Australian-Grand-Prix) always check how these must be stored. 

# Claude Code Git Workflow Instructions

## Branch Strategy

**Never commit directly to `main`.** The `main` branch triggers automatic Firebase deployments. Every push to `main` creates a new rollout, which is expensive and slow.

### Workflow

1. **Before starting any work**, create or switch to a feature branch:
   ```bash
   git checkout -b feature/<short-description>
   ```
   Examples: `feature/fix-raceid-handling`, `feature/add-sort-options`

2. **Make commits to the feature branch** as needed during development. Commit frequently here - it doesn't trigger deployments.

3. **Only merge to `main` when explicitly instructed** by the user with phrases like:
   - "merge to main"
   - "deploy this"
   - "push to production"
   - "ready to release"

4. **When merging**, squash commits to keep history clean:
   ```bash
   git checkout main
   git merge --squash feature/<branch-name>
   git commit -m "v1.x.x - <summary of changes>"
   git push origin main
   ```

5. **Clean up** the feature branch after merge:
   ```bash
   git branch -d feature/<branch-name>
   ```

## Commit Discipline

- **Batch related changes** into single commits where logical
- **Don't auto-commit** after every small fix - wait for a coherent unit of work
- **Ask before committing** if unsure whether changes are complete

## Quick Reference

| Action | Branch | Triggers Deploy? |
|--------|--------|------------------|
| Development work | `feature/*` | No |
| Merge to main | `main` | Yes |
| Hotfix (emergency only) | `main` | Yes |

## Remember

Each push to `main` = ~3-5 minute build + deployment costs. Batch your work.