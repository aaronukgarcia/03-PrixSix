# GUID: SCRIPT-REMEDIATE-002-v01
# [Type] Utility Script — outside production build, used in development and testing
# [Category] Remediation
# [Intent] Python script to generate remediation-plan-final.json from SECURITY-AUDIT-REPORT findings (phases 4-5).
# [Usage] python scripts/create-remediation-plan-phase4-5.py (run from project root)
# [Moved] 2026-02-24 from project root — codebase tidy-up
#
import json

# Load phases 1-3
with open(r'E:\GoogleDrive\Papers\03-PrixSix\03.Current\remediation-plan-p1-3.json', encoding='utf-8') as f:
    remediation_plan = json.load(f)

# Add phases 4 and 5
remediation_plan["phases"]["phase4"] = {
    "name": "Frontend Hardening - Low User Impact",
    "duration": "2 weeks",
    "userImpact": "Low - UI improvements and security enhancements",
    "priority": "Medium",
    "description": "Fix XSS vulnerabilities, improve admin panel security, add input validation",

    "modules": [
        {
            "module": "Admin Components XSS Fixes",
            "filesAffected": [
                "app/(app)/admin/_components/PubChatPanel.tsx",
                "app/(app)/admin/_components/EmailLogManager.tsx",
                "app/(app)/admin/_components/HotNewsManager.tsx"
            ],
            "issuesFixed": ["ADMINCOMP-001", "FRONTEND-001", "ADMINCOMP-004"],
            "estimatedEffort": "3 days",
            "priority": "Critical",
            "changes": [
                {
                    "file": "app/(app)/admin/_components/PubChatPanel.tsx",
                    "issue": "ADMINCOMP-001: XSS via dangerouslySetInnerHTML",
                    "lineNumbers": "333-336",
                    "fix": "Replace dangerouslySetInnerHTML with DOMPurify:\nimport DOMPurify from 'isomorphic-dompurify';\n\n<div \n  dangerouslySetInnerHTML={{\n    __html: DOMPurify.sanitize(message.content, {\n      ALLOWED_TAGS: ['p', 'br', 'strong', 'em'],\n      ALLOWED_ATTR: []\n    })\n  }}\n/>",
                    "testing": "1. Post chat message with safe HTML (should render)\n2. Attempt to post <script> tag (should be stripped)\n3. Attempt to post onclick handler (should be stripped)",
                    "dependencies": []
                },
                {
                    "file": "app/(app)/admin/_components/EmailLogManager.tsx",
                    "issue": "ADMINCOMP-004: Plaintext PIN display",
                    "lineNumbers": "565",
                    "fix": "Mask PIN by default with click-to-reveal:\nconst [revealedPins, setRevealedPins] = useState<Set<string>>(new Set());\n\nfunction togglePinVisibility(userId: string) {\n  setRevealedPins(prev => {\n    const next = new Set(prev);\n    if (next.has(userId)) next.delete(userId);\n    else next.add(userId);\n    return next;\n  });\n}\n\n<span>\n  {revealedPins.has(user.uid) ? user.pin : '******'}\n  <IconButton onClick={() => togglePinVisibility(user.uid)}>\n    {revealedPins.has(user.uid) ? <VisibilityOff /> : <Visibility />}\n  </IconButton>\n</span>",
                    "testing": "1. View email log (PINs should be masked)\n2. Click reveal icon (should show PIN)\n3. Click again (should mask PIN)\n4. Verify only one PIN revealed at a time",
                    "dependencies": []
                }
            ],
            "rollbackPlan": "Changes are UI-only and can be reverted without data migration"
        },

        {
            "module": "Admin Panel Server-Side Authorization",
            "filesAffected": [
                "app/(app)/admin/page.tsx",
                "app/(app)/admin/_components/SiteFunctionsManager.tsx",
                "app/(app)/admin/_components/HotNewsManager.tsx",
                "app/(app)/admin/_components/ResultsManager.tsx",
                "app/(app)/admin/_components/OnlineUsersManager.tsx"
            ],
            "issuesFixed": ["ADMINCOMP-003", "ADMINCOMP-005", "ADMINCOMP-006", "ADMINCOMP-007", "ADMINCOMP-008", "ADMINCOMP-009"],
            "estimatedEffort": "5 days",
            "priority": "Critical",
            "changes": [
                {
                    "file": "app/(app)/admin/page.tsx",
                    "issue": "ADMINCOMP-003: Client-side admin check can be bypassed",
                    "lineNumbers": "86-104",
                    "fix": "Move admin check to middleware (already added in Phase 1).\nAdd server-side rendering check:\n\nexport default async function AdminPage() {\n  const session = await getServerSession();\n  if (!session?.user?.isAdmin) {\n    redirect('/dashboard');\n  }\n  return <AdminPageClient />;\n}",
                    "testing": "1. Access /admin without auth (should redirect)\n2. Access /admin as non-admin (should redirect)\n3. Access /admin as admin (should show page)\n4. Verify cannot bypass with DevTools",
                    "dependencies": []
                },
                {
                    "file": "app/(app)/admin/_components/SiteFunctionsManager.tsx",
                    "issue": "ADMINCOMP-005: Direct Firestore writes without server validation",
                    "lineNumbers": "69-70",
                    "fix": "Route all updates through API:\n\nasync function updateSiteFunction(functionName: string, enabled: boolean) {\n  const response = await fetch('/api/admin/site-functions', {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify({ functionName, enabled })\n  });\n  \n  if (!response.ok) {\n    throw new Error('Failed to update site function');\n  }\n  \n  return response.json();\n}",
                    "testing": "1. Toggle site function as admin (should succeed)\n2. Monitor API logs for proper auth\n3. Verify Firestore rules still prevent direct client writes",
                    "dependencies": ["Create /api/admin/site-functions endpoint"]
                },
                {
                    "file": "app/(app)/admin/_components/ResultsManager.tsx",
                    "issue": "ADMINCOMP-007: Race result tampering via direct writes",
                    "lineNumbers": "258-274",
                    "fix": "Route through API with validation:\n\nasync function submitResults(raceId: string, results: RaceResults) {\n  const response = await fetch('/api/admin/submit-results', {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify({ raceId, results })\n  });\n  \n  if (!response.ok) {\n    throw new Error('Failed to submit results');\n  }\n  \n  // Trigger score calculation\n  await fetch('/api/admin/calculate-scores', {\n    method: 'POST',\n    body: JSON.stringify({ raceId })\n  });\n  \n  return response.json();\n}",
                    "testing": "1. Submit valid results (should succeed)\n2. Attempt to submit results for past race (should validate)\n3. Verify scores calculated correctly\n4. Verify Firestore rules prevent direct client writes",
                    "dependencies": ["Create /api/admin/submit-results and /api/admin/calculate-scores"]
                }
            ],
            "rollbackPlan": "Feature flag 'ENABLE_SERVER_SIDE_ADMIN' controls new behavior. Can fall back to client-side (with risk).",
            "validationSteps": [
                "Test all admin operations in staging",
                "Verify auth checks work correctly",
                "Test error handling when API calls fail",
                "Monitor admin panel usage for issues"
            ]
        },

        {
            "module": "Input Validation & Sanitization",
            "filesAffected": [
                "app/src/lib/validation.ts",
                "app/(app)/predictions/_components/PredictionEditor.tsx",
                "app/(app)/profile/page.tsx",
                "app/(app)/leagues/page.tsx"
            ],
            "issuesFixed": ["INPUT-VAL-001", "INPUT-VAL-002", "INPUT-VAL-003"],
            "estimatedEffort": "2 days",
            "priority": "Medium",
            "changes": [
                {
                    "file": "app/src/lib/validation.ts",
                    "issue": "Create centralized input validation",
                    "fix": "import { z } from 'zod';\n\nexport const emailSchema = z.string().email().toLowerCase();\nexport const passwordSchema = z.string().min(12).max(128);\nexport const displayNameSchema = z.string().min(2).max(50).regex(/^[a-zA-Z0-9 _-]+$/);\nexport const teamNameSchema = z.string().min(3).max(100);\nexport const leagueCodeSchema = z.string().length(8).regex(/^[A-Z0-9]+$/);\n\nexport function sanitizeInput(input: string): string {\n  return input.trim().replace(/[<>]/g, '');\n}\n\nexport function validateAndSanitize<T>(schema: z.Schema<T>, input: unknown): T {\n  return schema.parse(input);\n}",
                    "testing": "1. Test each schema with valid input\n2. Test each schema with invalid input\n3. Verify error messages helpful\n4. Test sanitization removes dangerous characters",
                    "dependencies": []
                }
            ],
            "rollbackPlan": "Validation is opt-in per component. Can disable without affecting functionality."
        },

        {
            "module": "Weak Randomness Fixes",
            "filesAffected": [
                "app/src/lib/leagues.ts",
                "app/src/lib/firebase-admin.ts"
            ],
            "issuesFixed": ["LIB-001", "LIB-002"],
            "estimatedEffort": "1 day",
            "priority": "Critical",
            "changes": [
                {
                    "file": "app/src/lib/leagues.ts",
                    "issue": "LIB-001: Weak randomness in invite code generation",
                    "lineNumbers": "32-40",
                    "fix": "Use crypto.randomBytes for secure random:\n\nimport crypto from 'crypto';\n\nexport function generateInviteCode(): string {\n  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';\n  const bytes = crypto.randomBytes(8);\n  let code = '';\n  \n  for (let i = 0; i < 8; i++) {\n    code += chars[bytes[i] % chars.length];\n  }\n  \n  return code;\n}",
                    "testing": "1. Generate 1000 invite codes\n2. Verify no duplicates\n3. Verify even distribution of characters\n4. Verify codes meet format requirements",
                    "dependencies": []
                },
                {
                    "file": "app/src/lib/firebase-admin.ts",
                    "issue": "LIB-002: Weak randomness in correlation ID",
                    "lineNumbers": "114-118",
                    "fix": "Use crypto.randomUUID:\n\nimport crypto from 'crypto';\n\nexport function generateCorrelationId(): string {\n  return `corr-${crypto.randomUUID()}`;\n}",
                    "testing": "1. Generate 1000 correlation IDs\n2. Verify no duplicates\n3. Verify format consistent\n4. Verify UUIDs are v4 (random)",
                    "dependencies": []
                }
            ],
            "rollbackPlan": "Both changes are drop-in replacements. Can revert if unexpected issues."
        }
    ],

    "totalIssuesFixed": 16,
    "successCriteria": [
        "All XSS vulnerabilities fixed with DOMPurify",
        "Admin panel requires server-side auth for all operations",
        "Input validation applied to all user-facing forms",
        "Cryptographically secure random generation everywhere",
        "PINs masked in admin interface",
        "Zero direct Firestore writes from admin components"
    ]
}

remediation_plan["phases"]["phase5"] = {
    "name": "Operational Excellence - No User Impact",
    "duration": "1 week",
    "userImpact": "None - operational improvements",
    "priority": "Low",
    "description": "Add monitoring, alerting, CI/CD pipeline, and operational safeguards",

    "modules": [
        {
            "module": "CI/CD Pipeline Implementation",
            "filesAffected": [
                ".github/workflows/ci.yml",
                ".github/workflows/deploy-production.yml",
                ".github/workflows/deploy-staging.yml"
            ],
            "issuesFixed": ["DEPLOY-004"],
            "estimatedEffort": "2 days",
            "priority": "High",
            "changes": [
                {
                    "file": ".github/workflows/ci.yml",
                    "issue": "DEPLOY-004: No CI/CD pipeline",
                    "fix": "Create GitHub Actions workflow:\n\nname: CI\n\non:\n  pull_request:\n    branches: [main, develop]\n  push:\n    branches: [main, develop]\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v3\n      - uses: actions/setup-node@v3\n        with:\n          node-version: '18'\n      - run: npm ci\n      - run: npm run lint\n      - run: npm run type-check\n      - run: npm test\n      - run: npm run build\n      \n  security-scan:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v3\n      - uses: snyk/actions/node@master\n        with:\n          command: test\n          args: --severity-threshold=high\n        env:\n          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}",
                    "testing": "1. Create test PR (should trigger CI)\n2. Verify all checks pass\n3. Introduce lint error (should fail CI)\n4. Fix and verify CI passes",
                    "dependencies": ["Configure GitHub Actions secrets"]
                },
                {
                    "file": ".github/workflows/deploy-production.yml",
                    "issue": "Automated production deployment",
                    "fix": "name: Deploy Production\n\non:\n  push:\n    branches: [main]\n\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    environment: production\n    steps:\n      - uses: actions/checkout@v3\n      - uses: actions/setup-node@v3\n      - run: npm ci\n      - run: npm run build\n      - uses: FirebaseExtended/action-hosting-deploy@v0\n        with:\n          repoToken: '${{ secrets.GITHUB_TOKEN }}'\n          firebaseServiceAccount: '${{ secrets.FIREBASE_SERVICE_ACCOUNT }}'\n          channelId: live\n          projectId: prix-six\n      - name: Deploy Functions\n        run: firebase deploy --only functions\n        env:\n          FIREBASE_TOKEN: ${{ secrets.FIREBASE_TOKEN }}",
                    "testing": "1. Merge to main (should trigger deployment)\n2. Verify app deployed to Firebase Hosting\n3. Verify functions deployed\n4. Verify rollback works if deployment fails",
                    "dependencies": []
                }
            ],
            "rollbackPlan": "Manual deployment process remains as fallback"
        },

        {
            "module": "Monitoring & Alerting",
            "filesAffected": [
                "app/src/lib/monitoring.ts",
                "functions/monitoring.js"
            ],
            "issuesFixed": ["DEPLOY-005", "MONITORING-001"],
            "estimatedEffort": "2 days",
            "priority": "High",
            "changes": [
                {
                    "file": "app/src/lib/monitoring.ts",
                    "issue": "DEPLOY-005: No health check monitoring",
                    "fix": "Set up health checks and alerting:\n\nimport { Monitoring } from '@google-cloud/monitoring';\n\nconst monitoring = new Monitoring();\n\nexport async function recordMetric(name: string, value: number, labels: Record<string, string> = {}) {\n  const dataPoint = {\n    interval: {\n      endTime: { seconds: Date.now() / 1000 }\n    },\n    value: { doubleValue: value }\n  };\n  \n  await monitoring.createTimeSeries({\n    name: monitoring.projectPath('prix-six'),\n    timeSeries: [{\n      metric: {\n        type: `custom.googleapis.com/${name}`,\n        labels\n      },\n      resource: {\n        type: 'global'\n      },\n      points: [dataPoint]\n    }]\n  });\n}\n\n// Set up alerts in Google Cloud Monitoring:\n// 1. Failed login rate > 10/min\n// 2. API error rate > 5%\n// 3. WhatsApp worker down > 5 min\n// 4. Firestore permission denied > 100/hour\n// 5. Email delivery failures > 10%",
                    "testing": "1. Trigger each alert condition\n2. Verify alert fires and notifies team\n3. Verify metrics visible in Cloud Console\n4. Test alert resolution notifications",
                    "dependencies": ["Configure Google Cloud Monitoring", "Set up PagerDuty integration"]
                },
                {
                    "file": "functions/monitoring.js",
                    "issue": "Add health check endpoints",
                    "fix": "exports.healthCheck = functions.https.onRequest((req, res) => {\n  const checks = {\n    firestore: false,\n    auth: false,\n    storage: false\n  };\n  \n  Promise.all([\n    admin.firestore().collection('_health').doc('test').get().then(() => checks.firestore = true),\n    admin.auth().getUser('test').catch(() => checks.auth = true), // Expected to fail\n    admin.storage().bucket().getFiles({ maxResults: 1 }).then(() => checks.storage = true)\n  ]).then(() => {\n    const healthy = Object.values(checks).every(c => c);\n    res.status(healthy ? 200 : 503).json({\n      status: healthy ? 'healthy' : 'degraded',\n      checks,\n      timestamp: new Date().toISOString()\n    });\n  });\n});",
                    "testing": "1. Call /healthCheck endpoint (should return 200)\n2. Verify all checks pass\n3. Simulate Firestore down (should return 503)\n4. Set up external monitoring to ping endpoint",
                    "dependencies": []
                }
            ],
            "rollbackPlan": "Monitoring is additive and can be disabled without affecting app functionality"
        },

        {
            "module": "Script Safety Guards",
            "filesAffected": [
                "scripts/backup-firestore.sh",
                "scripts/restore-firestore.sh",
                "scripts/delete-old-predictions.sh"
            ],
            "issuesFixed": ["SCRIPT-001", "SCRIPT-002", "SCRIPT-003"],
            "estimatedEffort": "1 day",
            "priority": "Medium",
            "changes": [
                {
                    "file": "scripts/backup-firestore.sh",
                    "issue": "SCRIPT-001: No confirmation prompt for destructive operations",
                    "fix": "Add safety checks:\n\n#!/bin/bash\nset -euo pipefail\n\n# Confirmation prompt\necho 'About to backup Firestore database. Continue? (yes/no)'\nread -r confirmation\nif [ \"$confirmation\" != \"yes\" ]; then\n  echo 'Aborted'\n  exit 1\nfi\n\n# Check if service account exists\nif [ ! -f \"./service-account.json\" ]; then\n  echo 'Error: service-account.json not found'\n  exit 1\nfi\n\n# Backup with timestamp\nTIMESTAMP=$(date +%Y%m%d-%H%M%S)\nBACKUP_PATH=\"gs://prix-six-backups/firestore-$TIMESTAMP\"\n\ngcloud firestore export \"$BACKUP_PATH\" \\\n  --project=prix-six \\\n  --async\n\necho \"Backup initiated: $BACKUP_PATH\"",
                    "testing": "1. Run script and cancel (should abort)\n2. Run script and confirm (should backup)\n3. Run without service account (should fail gracefully)\n4. Verify backup created in Cloud Storage",
                    "dependencies": []
                }
            ],
            "rollbackPlan": "Script changes are backwards compatible"
        },

        {
            "module": "Documentation & Runbooks",
            "filesAffected": [
                "docs/DEPLOYMENT.md",
                "docs/INCIDENT_RESPONSE.md",
                "docs/SECURITY.md",
                "docs/MONITORING.md"
            ],
            "issuesFixed": ["DOC-OPS-001", "DOC-OPS-002"],
            "estimatedEffort": "1 day",
            "priority": "Medium",
            "changes": [
                {
                    "file": "docs/DEPLOYMENT.md",
                    "issue": "Create deployment runbook",
                    "content": "# Deployment Guide\n\n## Prerequisites\n- Firebase CLI installed\n- Access to Google Cloud Console\n- Secrets configured in Secret Manager\n\n## Deployment Steps\n1. Run tests: `npm test`\n2. Build: `npm run build`\n3. Deploy to staging: `firebase deploy --project prix-six-staging`\n4. Test staging thoroughly\n5. Deploy to production: `firebase deploy --project prix-six`\n6. Verify production health checks\n7. Monitor for 30 minutes\n\n## Rollback Procedure\n1. Identify last working deployment\n2. Revert code: `git revert <commit>`\n3. Deploy reverted code\n4. Verify rollback successful\n\n## Emergency Contacts\n- On-call engineer: [PagerDuty]\n- Firebase support: support@firebase.com",
                    "testing": "1. Follow deployment guide\n2. Verify all steps work\n3. Update any outdated information",
                    "dependencies": []
                },
                {
                    "file": "docs/INCIDENT_RESPONSE.md",
                    "issue": "Create incident response runbook",
                    "content": "# Incident Response\n\n## Security Incident\n1. **Detect**: Monitor alerts, user reports\n2. **Contain**: Disable affected component via feature flag\n3. **Investigate**: Check logs, audit trail\n4. **Remediate**: Apply fix, rotate credentials if needed\n5. **Communicate**: Notify affected users\n6. **Document**: Write post-mortem\n\n## Service Outage\n1. Check health endpoints\n2. Review Cloud Console for errors\n3. Check Firestore quota limits\n4. Restart affected services\n5. Escalate if not resolved in 15 minutes\n\n## Data Loss\n1. Stop all writes immediately\n2. Identify last good backup\n3. Estimate data loss window\n4. Restore from backup\n5. Communicate to users\n6. Implement safeguards to prevent recurrence",
                    "testing": "1. Review with team\n2. Simulate incident drill\n3. Update based on learnings",
                    "dependencies": []
                }
            ],
            "rollbackPlan": "Documentation changes have no rollback risk"
        }
    ],

    "totalIssuesFixed": 10,
    "successCriteria": [
        "CI/CD pipeline running for all PRs and deployments",
        "Monitoring alerts configured and tested",
        "Health checks reporting correct status",
        "Scripts have safety guards",
        "Documentation complete and accurate",
        "Team trained on incident response procedures"
    ]
}

# Save complete plan
with open(r'E:\GoogleDrive\Papers\03-PrixSix\03.Current\remediation-plan-complete.json', 'w', encoding='utf-8') as f:
    json.dump(remediation_plan, f, indent=2)

total_fixed = sum([
    remediation_plan["phases"]["phase1"]["totalIssuesFixed"],
    remediation_plan["phases"]["phase2"]["totalIssuesFixed"],
    remediation_plan["phases"]["phase3"]["totalIssuesFixed"],
    remediation_plan["phases"]["phase4"]["totalIssuesFixed"],
    remediation_plan["phases"]["phase5"]["totalIssuesFixed"]
])

print(f"Created complete remediation plan (phases 1-5)")
print(f"Total issues addressed: {total_fixed} of 488")
print(f"Saved to: remediation-plan-complete.json")
