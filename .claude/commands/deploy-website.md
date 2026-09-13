Trigger a manual website deployment to Cloud Run.

Deployment is deliberate and separate from merging (Ways of Working §6).
Only run this when a human has explicitly asked for a deploy.

Steps:
1. Confirm with the person which commit is being shipped, and that `main` is
   the intended ref. The workflow refuses any other ref.
2. Run `gh workflow run deploy-website.yml --ref main`.
3. Stop there. Do not poll the run — CLAUDE.md is explicit that the user
   monitors deployment status themselves.

The workflow's first job is `verify-ci`, which refuses to deploy unless
`ci.yml` recorded a successful push-to-main run for that exact commit. A
failure there is a missing or failed CI run, not a deployment failure.

Service: writewise-website (europe-west10, project writewise-468912).
Build-time env vars are `NEXT_PUBLIC_*`, set from GitHub Secrets as Docker
build args — this is a Next.js app, not Vite.
