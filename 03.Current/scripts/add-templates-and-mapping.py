# GUID: SCRIPT-UTIL-001-v01
# [Type] Utility Script — outside production build, used in development and testing
# [Category] Utility
# [Intent] Python utility to add driver mapping and email templates to Firestore during initial environment setup.
# [Usage] python scripts/add-templates-and-mapping.py (run from project root)
# [Moved] 2026-02-24 from project root — codebase tidy-up
#
import json
from collections import defaultdict

# Load complete plan
with open(r'E:\GoogleDrive\Papers\03-PrixSix\03.Current\remediation-plan-complete.json', encoding='utf-8') as f:
    plan = json.load(f)

# Load book-of-work to get all issues
with open(r'E:\GoogleDrive\Papers\03-PrixSix\03.Current\book-of-work.json', encoding='utf-8') as f:
    book_of_work = json.load(f)

# Add communication templates
plan["communicationTemplates"] = {
    "migrationAnnouncement": {
        "subject": "Security Upgrade Coming to Prix Six",
        "body": """
Hi {displayName},

We're excited to announce a major security upgrade to Prix Six!

**What's Changing:**
Starting {migrationStartDate}, we'll be upgrading from 6-digit PINs to stronger passwords for better account security.

**Why This Matters:**
- Stronger protection against unauthorized access
- Browser autosave support (no more memorizing PINs!)
- Alternative sign-in options (Google, Apple)
- Enhanced security monitoring and alerting

**What You Need to Do:**
1. Log in to Prix Six after {migrationStartDate}
2. Follow the simple upgrade wizard
3. Choose a strong password (we recommend passphrases like "WilliamsAre_Champion2026")
4. Save it in your browser or password manager

**Timeline:**
- Migration starts: {migrationStartDate}
- Migration deadline: {migrationDeadline} (30 days)
- After deadline: PIN login disabled

**Need Help?**
Visit our migration FAQ: {faqUrl}
Contact support: {supportEmail}

Thanks for helping us keep Prix Six secure!

The Prix Six Team
        """.strip()
    },

    "migrationModal": {
        "title": "Security Upgrade Required",
        "body": """
**Welcome to More Secure Prix Six!**

We're upgrading from 6-digit PINs to stronger passwords.

**Your New Security Features:**
✓ Rate limiting (blocks brute force attacks)
✓ Exponential delay after failed attempts
✓ Cloudflare DDoS protection
✓ Full audit logging
✓ Real-time security alerts

**Create Your Password:**
- Minimum 12 characters
- Include uppercase, lowercase, and numbers
- Try a passphrase: "WilliamsAre_Champion2026"

**Or Sign In With:**
- Google
- Apple

You have 30 days to migrate. After that, PIN login will be disabled.
        """.strip(),
        "buttons": ["Migrate Now", "Remind Me Later"]
    },

    "reminderEmail7Days": {
        "subject": "Action Required: Migrate Your Prix Six Account (7 Days Left)",
        "body": """
Hi {displayName},

This is a reminder that you have **7 days** to upgrade your Prix Six account security.

**What Happens on {migrationDeadline}:**
- PIN login will be disabled
- You'll need a password to access your account
- Migration takes less than 2 minutes

**Migrate Now:**
1. Log in to Prix Six
2. Follow the upgrade wizard
3. Done!

**Haven't Started?**
Don't worry - it's easy! Just log in and we'll guide you through.

**Questions?**
FAQ: {faqUrl}
Support: {supportEmail}

See you on the track!

The Prix Six Team
        """.strip()
    },

    "reminderEmail1Day": {
        "subject": "URGENT: Migrate Your Prix Six Account by Tomorrow",
        "body": """
Hi {displayName},

**Your PIN login expires tomorrow ({migrationDeadline})!**

After tomorrow, you'll need a password to access Prix Six.

**Migrate now (takes 2 minutes):**
{migrationUrl}

**Need Help?**
Contact support: {supportEmail}

Don't get locked out - migrate today!

The Prix Six Team
        """.strip()
    },

    "completionAnnouncement": {
        "subject": "Security Upgrade Complete - Thank You!",
        "body": """
Hi {displayName},

Thank you for completing your security upgrade!

**Your Account is Now Protected With:**
✓ Strong password authentication
✓ Rate limiting and attack detection
✓ Security monitoring dashboard
✓ Audit logging

**New Features Available:**
- Security dashboard (see failed login attempts)
- Sign in with Google or Apple
- Browser password autosave

**Questions?**
Visit your security settings: {securitySettingsUrl}

Happy racing!

The Prix Six Team
        """.strip()
    },

    "migrationFAQ": {
        "title": "Password Migration FAQ",
        "questions": [
            {
                "q": "Why are you changing from PINs to passwords?",
                "a": "6-digit PINs have only 1 million combinations and are vulnerable to brute force attacks. Passwords with 12+ characters provide billions of times more security."
            },
            {
                "q": "What happens if I don't migrate?",
                "a": "After the migration deadline, PIN login will be disabled. You'll need to use the 'Forgot Password' feature to reset your account."
            },
            {
                "q": "Can I use my browser to save my password?",
                "a": "Yes! One of the benefits of passwords over PINs is that browsers can autosave them."
            },
            {
                "q": "What's a passphrase?",
                "a": "A passphrase is a password made of multiple words, like 'WilliamsAre_Champion2026'. They're easier to remember than random characters and just as secure."
            },
            {
                "q": "Can I still use PIN if I prefer?",
                "a": "No, we're disabling PIN authentication for security reasons. However, you can use Google or Apple sign-in instead of remembering a password."
            },
            {
                "q": "What if I forget my password?",
                "a": "Use the 'Forgot Password' link on the login page to reset via email."
            },
            {
                "q": "Is my data safe during migration?",
                "a": "Absolutely. Migration only affects how you log in, not your predictions, leagues, or results data."
            },
            {
                "q": "Can I migrate on mobile?",
                "a": "Yes, the migration works on any device. Mobile users can also use Google/Apple sign-in."
            }
        ]
    }
}

# Add file-by-file mapping
file_to_issues = defaultdict(list)

# Extract all critical issues from book-of-work
for issue in book_of_work.get('criticalIssues', []):
    file_path = issue.get('file', '').split(':')[0]
    if file_path:
        file_to_issues[file_path].append({
            "id": issue.get('id'),
            "severity": issue.get('severity'),
            "issue": issue.get('issue'),
            "impact": issue.get('impact'),
            "module": issue.get('module')
        })

# Create file-by-file remediation mapping
plan["fileByFileMapping"] = {
    "totalFiles": len(file_to_issues),
    "description": "Comprehensive mapping of all files requiring changes, organized to ensure each file is touched only once per phase",
    "files": []
}

for file_path, issues in sorted(file_to_issues.items()):
    # Determine which phase this file should be fixed in
    phase = "phase1"  # Default
    if "email" in file_path.lower():
        phase = "phase2"
    elif "admin" in file_path.lower() and "_components" in file_path:
        phase = "phase4"
    elif "auth" in file_path.lower() and any("auth" in i["id"].lower() for i in issues):
        phase = "phase3"
    elif "whatsapp" in file_path.lower():
        phase = "phase2"

    plan["fileByFileMapping"]["files"].append({
        "filePath": file_path,
        "phase": phase,
        "issueCount": len(issues),
        "issues": issues,
        "priority": "Critical" if any(i["severity"] == "critical" for i in issues) else "High"
    })

# Add rollback strategy
plan["rollbackStrategy"] = {
    "general": {
        "description": "Each phase has its own rollback plan. Feature flags enable gradual rollout.",
        "steps": [
            "Identify the issue (monitoring alerts, user reports)",
            "Assess severity (P0-P3)",
            "If P0 (critical), immediate rollback",
            "If P1-P2, evaluate if hotfix possible",
            "If rollback needed, revert to previous deployment",
            "Verify rollback successful via health checks",
            "Communicate to users if user-facing",
            "Post-mortem to prevent recurrence"
        ]
    },
    "byPhase": {
        "phase1": {
            "rollbackMethod": "Revert Firestore rules via Firebase Console",
            "dataRisk": "None - no data migration",
            "userImpact": "None - backend only",
            "rollbackTime": "< 5 minutes"
        },
        "phase2": {
            "rollbackMethod": "Revert code deployment, keep old secrets active",
            "dataRisk": "None - no data migration",
            "userImpact": "Minimal - may see old error messages",
            "rollbackTime": "< 10 minutes"
        },
        "phase3": {
            "rollbackMethod": "Feature flag ENABLE_PASSWORD_AUTH=false, re-enable PIN login",
            "dataRisk": "Migrated users retain passwords, can continue using them",
            "userImpact": "HIGH - migrated users can continue with password, non-migrated can continue with PIN",
            "rollbackTime": "< 1 minute (feature flag toggle)",
            "note": "Cannot rollback password migrations (users who migrated stay migrated)"
        },
        "phase4": {
            "rollbackMethod": "Revert code deployment",
            "dataRisk": "None",
            "userImpact": "Low - UI reverts to previous state",
            "rollbackTime": "< 10 minutes"
        },
        "phase5": {
            "rollbackMethod": "Disable monitoring alerts, manual deployment process",
            "dataRisk": "None",
            "userImpact": "None",
            "rollbackTime": "< 5 minutes"
        }
    }
}

# Add monitoring plan
plan["monitoringPlan"] = {
    "metricsToTrack": [
        {
            "metric": "authentication_success_rate",
            "description": "Percentage of successful login attempts",
            "alert": "< 95% for 5 minutes",
            "baseline": "99%"
        },
        {
            "metric": "migration_completion_rate",
            "description": "Percentage of active users who completed migration",
            "alert": "< 50% after 7 days",
            "target": "90% after 14 days"
        },
        {
            "metric": "failed_login_attempts",
            "description": "Number of failed logins per minute",
            "alert": "> 10/min for single account",
            "baseline": "< 1/min average"
        },
        {
            "metric": "api_error_rate",
            "description": "Percentage of API calls returning 5xx errors",
            "alert": "> 1% for 5 minutes",
            "baseline": "< 0.1%"
        },
        {
            "metric": "firestore_permission_denied",
            "description": "Number of Firestore permission denied errors",
            "alert": "> 100/hour",
            "baseline": "< 10/hour"
        },
        {
            "metric": "email_delivery_failure_rate",
            "description": "Percentage of emails that fail to send",
            "alert": "> 5% for 15 minutes",
            "baseline": "< 1%"
        },
        {
            "metric": "whatsapp_worker_uptime",
            "description": "Percentage of time WhatsApp worker is healthy",
            "alert": "< 99% for 15 minutes",
            "baseline": "99.9%"
        }
    ],

    "dashboards": [
        {
            "name": "Security Metrics Dashboard",
            "url": "https://console.cloud.google.com/monitoring/dashboards/custom/security",
            "panels": [
                "Failed login attempts (by account, by IP)",
                "Attack alerts (unacknowledged)",
                "Rate limit triggers",
                "Suspicious activity flags",
                "Migration completion rate"
            ]
        },
        {
            "name": "Application Health Dashboard",
            "url": "https://console.cloud.google.com/monitoring/dashboards/custom/health",
            "panels": [
                "API response times (p50, p95, p99)",
                "API error rate (by endpoint)",
                "Cloud Functions execution time",
                "Firestore operations (reads/writes/deletes)",
                "Firebase Auth operations"
            ]
        },
        {
            "name": "User Experience Dashboard",
            "url": "https://console.cloud.google.com/monitoring/dashboards/custom/ux",
            "panels": [
                "Page load times",
                "Migration funnel (started, completed, abandoned)",
                "Support ticket volume",
                "User feedback sentiment"
            ]
        }
    ]
}

# Add testing strategy
plan["testingStrategy"] = {
    "perPhase": {
        "phase1": {
            "unitTests": [
                "Firestore rules emulator tests",
                "API auth middleware tests",
                "Secret loading tests"
            ],
            "integrationTests": [
                "End-to-end API route tests with auth",
                "Firestore rules against real-world scenarios",
                "Secret Manager integration"
            ],
            "stagingTests": [
                "Full smoke test suite",
                "Security penetration testing",
                "Load testing (ensure no performance regression)"
            ]
        },
        "phase2": {
            "unitTests": [
                "Email sanitization tests",
                "WhatsApp worker auth tests",
                "Cloud Functions error handling tests"
            ],
            "integrationTests": [
                "Email delivery end-to-end",
                "WhatsApp message sending",
                "Error propagation through system"
            ],
            "stagingTests": [
                "Send test emails to multiple clients",
                "WhatsApp integration testing",
                "Error monitoring validation"
            ]
        },
        "phase3": {
            "unitTests": [
                "Password validation tests",
                "Rate limiting tests",
                "OAuth integration tests"
            ],
            "integrationTests": [
                "Full migration flow",
                "Login with password",
                "Login with OAuth",
                "Rate limiting enforcement"
            ],
            "stagingTests": [
                "Beta user migration (50 users)",
                "Load test authentication endpoints",
                "Security penetration testing"
            ],
            "betaTesting": {
                "description": "Invite 50 active users to beta test migration",
                "duration": "1 week",
                "successCriteria": [
                    "95% successful migration",
                    "< 5% negative feedback",
                    "No data loss",
                    "Average migration time < 3 minutes"
                ]
            }
        },
        "phase4": {
            "unitTests": [
                "DOMPurify sanitization tests",
                "Input validation tests",
                "Crypto random generation tests"
            ],
            "integrationTests": [
                "Admin panel operations",
                "XSS attack prevention",
                "Form validation across app"
            ],
            "stagingTests": [
                "XSS payload testing",
                "Admin panel security testing",
                "Accessibility testing"
            ]
        },
        "phase5": {
            "unitTests": [
                "Health check tests",
                "Monitoring metric recording tests"
            ],
            "integrationTests": [
                "CI/CD pipeline execution",
                "Alert triggering and resolution",
                "Script execution with safety guards"
            ],
            "stagingTests": [
                "Deploy via CI/CD pipeline",
                "Trigger all monitoring alerts",
                "Execute all operational scripts"
            ]
        }
    }
}

# Save final plan
with open(r'E:\GoogleDrive\Papers\03-PrixSix\03.Current\remediation-plan-final.json', 'w', encoding='utf-8') as f:
    json.dump(plan, f, indent=2)

print("Final remediation plan created!")
print(f"Total files requiring changes: {plan['fileByFileMapping']['totalFiles']}")
print(f"Communication templates: {len(plan['communicationTemplates'])}")
print(f"Monitoring metrics: {len(plan['monitoringPlan']['metricsToTrack'])}")
print(f"Saved to: remediation-plan-final.json")
