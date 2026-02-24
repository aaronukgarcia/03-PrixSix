# GUID: SCRIPT-REMEDIATE-001-v01
# [Type] Utility Script — outside production build, used in development and testing
# [Category] Remediation
# [Intent] Python script to generate remediation-plan-p1-3.json from SECURITY-AUDIT-REPORT findings (phases 1-3).
# [Usage] python scripts/create-remediation-plan-phase1-3.py (run from project root)
# [Moved] 2026-02-24 from project root — codebase tidy-up
#
import json
from datetime import datetime, timedelta

# Load existing book-of-work.json
with open(r'E:\GoogleDrive\Papers\03-PrixSix\03.Current\book-of-work.json', encoding='utf-8') as f:
    book_of_work = json.load(f)

# Create comprehensive remediation plan - Phases 1-3
remediation_plan_p1_3 = {
    "metadata": {
        "created": datetime.now().isoformat(),
        "totalIssues": 488,
        "phases": 5,
        "estimatedTotalEffort": "8-10 weeks (2 developers)",
        "milestoneDates": {
            "phase1Complete": "2026-02-24",
            "phase2Complete": "2026-03-10",
            "phase3Complete": "2026-03-31",
            "phase4Complete": "2026-04-14",
            "phase5Complete": "2026-04-21",
            "migrationDeadline": "2026-03-12",
            "migrationGracePeriodEnd": "2026-04-12"
        }
    },

    "executionPrinciples": [
        "Each file touched only once per phase to minimize merge conflicts",
        "Dependency-ordered execution (fix foundation before building on it)",
        "Comprehensive testing after each module completion",
        "Feature flags for gradual rollout of user-facing changes",
        "Rollback plans documented for each phase",
        "User communication synchronized with technical deployment"
    ],

    "phases": {
        "phase1": {
            "name": "Foundation Security - No User Impact",
            "duration": "2 weeks",
            "userImpact": "None",
            "priority": "Critical",
            "description": "Fix foundational security issues in rules, secrets, and server-side auth without changing user experience",

            "modules": [
                {
                    "module": "Firestore Security Rules Hardening",
                    "filesAffected": [
                        "firestore.rules",
                        "app/src/firebase/firestore/rules"
                    ],
                    "issuesFixed": ["FIRESTORE-001", "FIRESTORE-002", "FIRESTORE-003", "GEMINI-001", "GEMINI-002"],
                    "estimatedEffort": "3 days",
                    "priority": "Critical"
                },
                {
                    "module": "Firebase Storage Rules",
                    "filesAffected": ["storage.rules"],
                    "issuesFixed": ["STORAGE-001", "STORAGE-002"],
                    "estimatedEffort": "1 day",
                    "priority": "High"
                },
                {
                    "module": "Secrets Management Migration",
                    "filesAffected": [
                        "app/.env.local",
                        "whatsapp-worker/.env",
                        "scripts/service-account.json",
                        "whatsapp-worker/service-account.json",
                        "whatsapp-worker/.api-key.txt"
                    ],
                    "issuesFixed": ["CONFIG-001", "BACKUP-001", "DEPLOY-001", "DEPLOY-002", "DEPLOY-003"],
                    "estimatedEffort": "2 days",
                    "priority": "Critical"
                },
                {
                    "module": "API Route Server-Side Auth",
                    "filesAffected": [
                        "app/api/auth/reset-pin/route.ts",
                        "app/api/submit-prediction/route.ts",
                        "app/api/admin/*/route.ts",
                        "app/middleware.ts"
                    ],
                    "issuesFixed": ["API-006", "API-013", "ADMIN-001", "ADMIN-002"],
                    "estimatedEffort": "4 days",
                    "priority": "Critical"
                }
            ],

            "totalIssuesFixed": 15,
            "successCriteria": [
                "All Firestore rules pass emulator tests",
                "All secrets loaded from Secret Manager",
                "All API routes require proper authentication",
                "Zero production secrets remain in code repository",
                "Timing attacks on auth endpoints mitigated"
            ]
        },

        "phase2": {
            "name": "Backend Security Hardening - Minimal User Impact",
            "duration": "2 weeks",
            "userImpact": "Minimal - improved error messages, email security",
            "priority": "High",
            "description": "Harden email system, WhatsApp worker, Cloud Functions, and error handling",

            "modules": [
                {
                    "module": "Email System XSS Prevention",
                    "filesAffected": [
                        "app/src/lib/email.ts",
                        "app/api/send-verification-email/route.ts",
                        "app/api/send-hot-news-email/route.ts",
                        "app/api/send-results-email/route.ts"
                    ],
                    "issuesFixed": ["EMAIL-001", "EMAIL-002", "EMAIL-003", "EMAIL-004", "EMAIL-005"],
                    "estimatedEffort": "3 days",
                    "priority": "Critical"
                },
                {
                    "module": "WhatsApp Worker Security",
                    "filesAffected": [
                        "whatsapp-worker/src/index.ts",
                        "whatsapp-worker/src/azure-store.ts",
                        "whatsapp-worker/src/firebase-config.ts"
                    ],
                    "issuesFixed": ["WHATSAPP-001", "WHATSAPP-002", "WHATSAPP-003", "WHATSAPP-004"],
                    "estimatedEffort": "3 days",
                    "priority": "Critical"
                },
                {
                    "module": "Cloud Functions Error Handling",
                    "filesAffected": ["functions/index.js"],
                    "issuesFixed": ["CLOUD-001", "CLOUD-002", "CLOUD-003", "CLOUD-004", "ERROR-CLOUD-001"],
                    "estimatedEffort": "2 days",
                    "priority": "High"
                },
                {
                    "module": "Admin API Route Fixes",
                    "filesAffected": ["app/api/admin/update-user/route.ts"],
                    "issuesFixed": ["ADMINCOMP-002"],
                    "estimatedEffort": "1 day",
                    "priority": "High"
                }
            ],

            "totalIssuesFixed": 18,
            "successCriteria": [
                "All email XSS vectors neutralized",
                "WhatsApp worker requires auth on all sensitive endpoints",
                "Cloud Functions use centralized error registry",
                "Admin role management API functional",
                "Zero credential exposure in error logs"
            ]
        },

        "phase3": {
            "name": "Authentication Upgrade - HIGH User Impact",
            "duration": "3 weeks",
            "userImpact": "HIGH - All users must migrate from PIN to password",
            "priority": "Critical",
            "description": "Migrate from 6-digit PIN to strong passwords/passphrases with OAuth alternatives",

            "modules": [
                {
                    "module": "Password System Implementation",
                    "filesAffected": [
                        "app/src/lib/auth.ts",
                        "app/api/auth/*/route.ts",
                        "app/src/firebase/auth.ts"
                    ],
                    "issuesFixed": ["AUTH-001", "AUTH-002", "PIN-SECURITY-001"],
                    "estimatedEffort": "5 days",
                    "priority": "Critical"
                },
                {
                    "module": "Migration UI and Flow",
                    "filesAffected": [
                        "app/(auth)/migrate-account/page.tsx",
                        "app/src/components/MigrationModal.tsx",
                        "app/src/components/PasswordStrengthMeter.tsx"
                    ],
                    "issuesFixed": ["UX-MIGRATION-001"],
                    "estimatedEffort": "4 days",
                    "priority": "Critical"
                },
                {
                    "module": "OAuth Integration (Apple & Google)",
                    "filesAffected": [
                        "app/src/firebase/auth.ts",
                        "app/(auth)/login/page.tsx",
                        "app/(auth)/signup/page.tsx"
                    ],
                    "issuesFixed": ["AUTH-OAUTH-001"],
                    "estimatedEffort": "3 days",
                    "priority": "High"
                },
                {
                    "module": "Rate Limiting Implementation",
                    "filesAffected": [
                        "app/src/lib/rate-limit.ts",
                        "app/api/auth/login/route.ts",
                        "app/middleware.ts"
                    ],
                    "issuesFixed": ["SECURITY-RATE-LIMIT-001"],
                    "estimatedEffort": "2 days",
                    "priority": "High"
                },
                {
                    "module": "Security Dashboard Card",
                    "filesAffected": [
                        "app/(app)/dashboard/_components/SecurityDashboard.tsx",
                        "app/src/components/DashboardCard.tsx"
                    ],
                    "issuesFixed": ["UX-SECURITY-DASHBOARD-001"],
                    "estimatedEffort": "2 days",
                    "priority": "Medium"
                }
            ],

            "userCommunicationPlan": {
                "announcements": [
                    {
                        "timing": "1 week before migration starts",
                        "channel": "Email + In-app notification",
                        "content": "See communicationTemplates.migrationAnnouncement"
                    },
                    {
                        "timing": "Migration day",
                        "channel": "In-app modal (blocking)",
                        "content": "See communicationTemplates.migrationModal"
                    },
                    {
                        "timing": "7 days before deadline",
                        "channel": "Email reminder",
                        "content": "See communicationTemplates.reminderEmail7Days"
                    },
                    {
                        "timing": "1 day before deadline",
                        "channel": "Email + In-app banner",
                        "content": "See communicationTemplates.reminderEmail1Day"
                    },
                    {
                        "timing": "After migration complete",
                        "channel": "Email + In-app notification",
                        "content": "See communicationTemplates.completionAnnouncement"
                    }
                ]
            },

            "migrationMetrics": {
                "targetMetrics": [
                    "90% of active users migrated within 14 days",
                    "< 5% support tickets related to migration",
                    "< 1% rollback requests",
                    "Zero data loss during migration"
                ],
                "monitoring": [
                    "Daily migration rate (dashboard)",
                    "Failed migration attempts",
                    "Support ticket volume",
                    "User sentiment (feedback forms)"
                ]
            },

            "totalIssuesFixed": 8,
            "successCriteria": [
                "Password system fully implemented and tested",
                "Migration modal appears for all non-migrated users",
                "OAuth providers (Google, Apple) functional",
                "Rate limiting prevents credential stuffing",
                "Security dashboard card displays accurate data",
                "90% of users successfully migrated within 2 weeks"
            ]
        }
    }
}

# Save
with open(r'E:\GoogleDrive\Papers\03-PrixSix\03.Current\remediation-plan-p1-3.json', 'w', encoding='utf-8') as f:
    json.dump(remediation_plan_p1_3, f, indent=2)

print("Created phases 1-3 of remediation plan")
print(f"Total issues in phases 1-3: {remediation_plan_p1_3['phases']['phase1']['totalIssuesFixed'] + remediation_plan_p1_3['phases']['phase2']['totalIssuesFixed'] + remediation_plan_p1_3['phases']['phase3']['totalIssuesFixed']}")
