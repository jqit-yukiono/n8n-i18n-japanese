#!/usr/bin/env bash
# Post a single-line escalation message to Slack via Incoming Webhook.
# Designed to be called from GitHub Actions on failure / human-review
# escalation paths only, so the normal auto-loop stays silent.
#
# Inputs are taken from environment variables to avoid shell quoting
# issues with values that may contain user-controlled content (PR titles,
# commit subjects, etc.). Actions sets `env:` values without re-evaluating
# them in the shell, so there is no injection vector via `${{ ... }}`
# templates either.
#
# Required env:
#   SLACK_WEBHOOK_URL  Slack incoming webhook URL (repo secret).
#   SLACK_TEXT         Free-form message body.
#
# Optional env:
#   SLACK_URL          Link URL appended as "<url|details>".
#
# Failure policy:
#   - SLACK_WEBHOOK_URL unset/empty -> log and exit 0 (skip).
#   - SLACK_TEXT unset/empty        -> log and exit 0 (skip).
#   - Webhook POST failure          -> log warning and exit 0.
#   Slack notification must never block the calling workflow.

set -uo pipefail

if [[ -z "${SLACK_WEBHOOK_URL:-}" ]]; then
  echo "slack-notify: SLACK_WEBHOOK_URL not set; skipping"
  exit 0
fi

if [[ -z "${SLACK_TEXT:-}" ]]; then
  echo "slack-notify: SLACK_TEXT not set; skipping"
  exit 0
fi

if ! command -v jq > /dev/null 2>&1; then
  echo "slack-notify: jq not found on PATH; skipping" >&2
  exit 0
fi

if [[ -n "${SLACK_URL:-}" ]]; then
  body=$(jq -n --arg text "$SLACK_TEXT" --arg url "$SLACK_URL" '
    {text: ($text + "\n<" + $url + "|details>")}')
else
  body=$(jq -n --arg text "$SLACK_TEXT" '{text: $text}')
fi

if ! curl -fsS -X POST -H 'Content-Type: application/json' \
     --max-time 10 --retry 2 --retry-delay 2 \
     -d "$body" "$SLACK_WEBHOOK_URL" > /dev/null; then
  # Do not propagate the failure: a transient Slack outage must not
  # mark the orchestration workflow itself as failed.
  echo "::warning::slack-notify: webhook POST failed (non-fatal)" >&2
  exit 0
fi

echo "slack-notify: posted"

# SonarQube check (throwaway)
