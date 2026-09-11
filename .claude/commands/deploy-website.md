Trigger a manual website deployment to Cloud Run and monitor it to completion.

Steps:
1. Run `gh workflow run deploy-website.yml` to trigger the deployment
2. Wait 5 seconds, then run `gh run list --limit 3` to get the run ID
3. Run `gh run view <run-id>` to show the deployment status
4. If the run is still in progress, check again after a few seconds
5. Report the final status (success/failure) and confirm the site is live at https://fluentina.com

Service: writewise-website (europe-west10, project writewise-468912)
Note: Vite env vars (VITE_STRAPI_URL, VITE_STRIPE_PUBLIC_KEY etc.) are baked in at build time from GitHub Secrets.
