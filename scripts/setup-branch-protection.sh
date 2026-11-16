#!/usr/bin/env bash
set -euo pipefail

gh api -X PUT "repos/evanfang0054/baton/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["verify (22)", "verify (24)", "e2e", "build"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1
  },
  "restrictions": null
}
JSON
