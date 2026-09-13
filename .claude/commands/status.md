Show a full health snapshot of the Fluentina project — git, deployments, and live services.

Run all of the following in parallel, then present a combined summary:

1. **Git status**: `git status --short` and `git log --oneline -5`
2. **Recent deployments**: `gh run list --limit 5`
3. **Cloud Run services**: `gcloud run services list --project=writewise-468912 --region=europe-west10`
4. **Live checks** (curl, expect HTTP 200):
   - `curl -s -o /dev/null -w "%{http_code}" https://fluentina.com`
   - `curl -s -o /dev/null -w "%{http_code}" https://cms.fluentina.com/admin`

Present results as a concise status table. Flag anything that looks wrong (non-200 responses, failed deployments, unexpected git state).
