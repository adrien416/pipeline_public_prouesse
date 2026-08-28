#!/usr/bin/env bash
set +e

export PATH="$HOME/.strix/bin:$PATH"
: "${RESULTS_DIR:?RESULTS_DIR is required}"

run_scan() {
  local name="$1"
  local target="$2"
  local focus="$3"
  local work="$RUNNER_TEMP/strix-$name"
  local out="$RESULTS_DIR/$name"

  mkdir -p "$work" "$out"

  {
    printf '%s\n' 'AUTHORISATION'
    printf '%s\n' 'This is an authorised security assessment requested by the owner, Adrien Pannetier, on 21 August 2026.'
    printf '\n%s\n' 'IN SCOPE'
    printf 'Only %s and same-origin paths, APIs and static assets. Do not follow or test any other host.\n' "$target"
    printf '\n%s\n' 'SAFETY AND EXCLUSIONS'
    printf '%s\n' '- Non-destructive testing only. Do not impair availability or normal users.'
    printf '%s\n' '- Maximum 2 HTTP requests per second and no more than 5 variants per endpoint or payload family.'
    printf '%s\n' '- No denial of service, stress/load testing, brute force, password spraying, credential stuffing, phishing or social engineering.'
    printf '%s\n' '- Do not create accounts, bookings, polls, calendar events, messages, emails or WhatsApp notifications.'
    printf '%s\n' '- Do not upload, overwrite, move, publish, delete or download real documents or user data.'
    printf '%s\n' '- Do not invoke reminder, resend, cancellation, rescheduling, bulk delivery, admin mutation or force/test-email endpoints.'
    printf '%s\n' '- Do not access third-party infrastructure, including Supabase project domains, Google APIs, Brevo, Unipile, Microsoft, Clarity or api-adresse.data.gouv.fr.'
    printf '%s\n' '- Do not persist access, create shells, alter configuration or leave test data behind.'
    printf '%s\n' '- For suspected access-control issues, prove impact with status codes, headers, HEAD/range-zero requests or synthetic identifiers; stop before retrieving sensitive content.'
    printf '%s\n' '- Redact personal data and secrets from the report.'
    printf '\n%s\n' 'TEST PRIORITIES'
    printf '%s\n' "$focus"
    printf '%s\n' 'Also assess authentication/session handling, BOLA/IDOR, tenant or role isolation, injection, SSRF, open redirects, CORS, CSP, cache-control, host-header handling, token leakage/entropy, rate limiting and exposed serverless functions.'
    printf '\n%s\n' 'REPORTING'
    printf '%s\n' 'Report only reproducible findings. Include exact non-destructive reproduction steps, affected route, impact, confidence and remediation. Clearly label unvalidated hypotheses.'
  } > "$work/rules-of-engagement.md"

  cd "$work" || return 1
  timeout --signal=TERM --kill-after=30s 45m \
    strix -n --target "$target" --scan-mode quick --instruction-file "$work/rules-of-engagement.md" \
    > "$out/strix-stdout-stderr.log" 2>&1
  local exit_code=$?

  printf '%s\n' "$exit_code" > "$out/strix-exit-code.txt"
  printf '%s\n' "$target" > "$out/target.txt"
  date -u +'%Y-%m-%dT%H:%M:%SZ' > "$out/completed-at.txt"

  if [ -d "$work/strix_runs" ]; then
    cp -a "$work/strix_runs" "$out/"
  fi
  find "$work" -maxdepth 6 -type f -printf '%P\n' | sort > "$out/work-files.txt" 2>/dev/null
  cd "$GITHUB_WORKSPACE" || return 1
}

run_scan \
  rempart \
  'https://dataroom.prouesse.vc' \
  'Prioritise unauthenticated access paths, invitation and magic-link handling, document/download authorisation, cross-dataroom and cross-buyer isolation, public-link scoping, Q&A visibility boundaries, audit endpoints and Next.js/Supabase boundary mistakes. Never retrieve an existing document.'

run_scan \
  prouesse-calendrier \
  'https://prouesse-calendrier.netlify.app' \
  'Prioritise admin authentication and OTP challenge design, booking/cancel/reschedule token handling, poll IDs and voting, serverless function exposure, host/user separation, double-booking race controls, email-header injection and proxy/subpath inconsistencies. Do not submit any booking, vote, reminder, email or mutation.'

exit 0
