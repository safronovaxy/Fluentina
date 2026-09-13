Fetch and display recent Cloud Run logs for a Fluentina service.

The argument $ARGUMENTS should be "cms", "website", or left empty (defaults to cms).

Steps:
1. Determine which service to show based on $ARGUMENTS:
   - "cms" or empty → service name: writewise-cms
   - "website" → service name: writewise-website
2. Run the gcloud logging command:
   `gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=<service>" --project=writewise-468912 --limit=50 --format=json`
3. Parse and display the log entries in a readable format, highlighting any errors or warnings
4. Summarise any notable errors found

GCP project: writewise-468912 | Region: europe-west10
