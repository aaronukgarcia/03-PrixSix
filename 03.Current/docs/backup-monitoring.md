# Prix Six Backup Monitoring — Dead Man's Switch

## Overview

This alert fires when the `dailyBackup` Cloud Function has not emitted a
`BACKUP_HEARTBEAT` structured log within the past 25 hours. Since the function
runs every 24 hours (02:00 UTC), a 25-hour window gives a 1-hour grace period.

The heartbeat is emitted on both success and failure, so the Dead Man's Switch
only fires if the function itself is not running at all (e.g. Cloud Scheduler
is broken, the function was deleted, or deployment failed).

---

## Step 1: Create the Log-Based Metric

```bash
gcloud logging metrics create backup_heartbeat_count \
  --project=prix6-prod \
  --description="Counts BACKUP_HEARTBEAT structured log entries from dailyBackup" \
  --log-filter='resource.type="cloud_run_revision"
jsonPayload.message="BACKUP_HEARTBEAT"'
```

### Verify the metric

After the next backup runs, check that the metric is counting:

```bash
gcloud logging metrics describe backup_heartbeat_count --project=prix6-prod
```

---

## Step 2: Create the MQL Alert Policy

Create a notification channel first (email, Slack, PagerDuty, etc.), then
create the alert policy using MQL (Monitoring Query Language).

### Create a notification channel (email example)

```bash
gcloud alpha monitoring channels create \
  --project=prix6-prod \
  --display-name="Prix Six Ops Email" \
  --type=email \
  --channel-labels=email_address=ops@prix6.example.com
```

Note the channel ID from the output (format: `projects/prix6-prod/notificationChannels/XXXXXXXXXX`).

### Create the alert policy

```bash
gcloud alpha monitoring policies create \
  --project=prix6-prod \
  --display-name="Backup Dead Man's Switch" \
  --condition-display-name="No BACKUP_HEARTBEAT in 25h" \
  --notification-channels="projects/prix6-prod/notificationChannels/CHANNEL_ID" \
  --combiner=OR \
  --condition-filter='metric.type="logging.googleapis.com/user/backup_heartbeat_count" AND resource.type="cloud_run_revision"' \
  --condition-threshold-value=1 \
  --condition-threshold-comparison=COMPARISON_LT \
  --condition-threshold-duration=90000s \
  --condition-threshold-aggregation='{"alignmentPeriod":"90000s","perSeriesAligner":"ALIGN_COUNT"}'
```

> **90000s = 25 hours.** The alert fires when the count of heartbeat logs
> drops below 1 within a 25-hour window.

### Equivalent MQL (for Cloud Console UI)

If you prefer to create the policy in the Cloud Console Monitoring UI, use
this MQL query:

```
fetch cloud_run_revision
| metric 'logging.googleapis.com/user/backup_heartbeat_count'
| align rate(25h)
| every 1h
| condition absent_for 25h
```

---

## Step 3: Verify

1. **Trigger a manual backup** to generate a heartbeat:
   ```bash
   gcloud functions call dailyBackup --project=prix6-prod --region=europe-west2
   ```

2. **Check Cloud Logging** for the heartbeat:
   ```bash
   gcloud logging read 'jsonPayload.message="BACKUP_HEARTBEAT"' \
     --project=prix6-prod \
     --limit=5 \
     --format=json
   ```

3. **Check the metric** in Cloud Console:
   Navigate to Monitoring > Metrics Explorer > search for `backup_heartbeat_count`.

4. **Test the alert** by temporarily disabling the Cloud Scheduler job and
   waiting 25+ hours (or adjust the threshold for testing).

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Alert fires but backups ran | Log filter doesn't match structured log format | Check `jsonPayload.message` vs `textPayload` |
| Metric shows 0 | Function not deployed or erroring before log emit | Check Cloud Functions logs |
| No alert fires when expected | Notification channel not verified | Verify email/Slack channel in Monitoring |
| Heartbeat logged but metric empty | Resource type mismatch | Update filter to match actual `resource.type` |

---

## Architecture

```
Cloud Scheduler (0 2 * * *)
    │
    ▼
dailyBackup (Cloud Function)
    │
    ├──► Firestore export → gs://prix6-backups/YYYY-MM-DD/
    ├──► Auth JSON export → gs://prix6-backups/YYYY-MM-DD/auth/
    ├──► Write backup_status/latest
    └──► Emit BACKUP_HEARTBEAT structured log
              │
              ▼
    Log-based metric: backup_heartbeat_count
              │
              ▼
    Alert policy: fires if count < 1 in 25h window
              │
              ▼
    Notification channel (email/Slack/PagerDuty)
```
