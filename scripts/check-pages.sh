#!/usr/bin/env bash
# Restart the dev server and confirm the main pages actually render.
#
# Written because the same failure kept reaching the user: a change lands, the running
# dev server keeps serving something stale — Tailwind CSS that lacks a newly-introduced
# class, or a Prisma client generated before the last migration — and the page renders
# blank or 500s. A build passing says nothing about it, because the build is a separate
# process from the one serving the page.
#
#   ./scripts/check-pages.sh            # restart, load the pages, report
#
# Requires being signed in already; it drives the real browser rather than curl, since
# every page is behind auth.

set -uo pipefail
cd "$(dirname "$0")/.."

LOG="${TMPDIR:-/tmp}/closet-dev.log"
PAGES=(/ /catalog /outfits /outfits/new /calendar /inspiration /inspiration/new)

echo "→ restarting dev server"
lsof -ti:3000 | xargs kill 2>/dev/null
sleep 1
npm run dev >"$LOG" 2>&1 &

for _ in $(seq 1 30); do
  grep -q "Ready in" "$LOG" 2>/dev/null && break
  sleep 1
done
grep -q "Ready in" "$LOG" || { echo "✗ dev server never became ready"; tail -5 "$LOG"; exit 1; }

# One at a time, with a pause: browsers defer image layout in unfocused tabs, and
# opening them in a burst produces spurious zero-height reports.
for page in "${PAGES[@]}"; do
  open "http://localhost:3000${page}"
  sleep 5
done
sleep 3

# The whole log: it is truncated on each run, and marking a position misses the
# requests that already-open browser tabs fire the instant the server restarts —
# which is what made this script wrongly report every page as failing.
NEW=$(cat "$LOG")
STATUS=0

# Each of these has actually shipped to the user at least once.
check() {
  local pattern="$1" label="$2" exclude="${3:-$^}"
  local hits
  hits=$(printf '%s\n' "$NEW" | grep -ivE "$exclude" | grep -ciE "$pattern")
  if [ "$hits" -gt 0 ]; then
    echo "✗ $label ($hits)"
    printf '%s\n' "$NEW" | grep -ivE "$exclude" | grep -iE "$pattern" | head -2 | cut -c1-140
    STATUS=1
  else
    echo "✓ $label"
  fi
}

check "unknown field|unknown arg"        "no stale Prisma client"
# Killing the dev server aborts whatever RSC prefetches the open tabs had in flight,
# and each one logs a browser-side rejection followed by a successful fallback
# navigation. That is the restart working, not the app failing, so it is excluded —
# narrowly, by the message, rather than by muting browser lines wholesale.
check "⨯|unhandled|server error|500 in " "no server errors" \
      "failed to fetch rsc payload|\"⨯ unhandledrejection:\" undefined"

# Advisory only. Next reports height 0 for a `fill` image that was measured before its
# tab laid out, which happens routinely in background tabs — so this flags a page worth
# looking at rather than a definite fault.
zero=$(printf '%s\n' "$NEW" | grep -ciE "height value of 0")
[ "$zero" -gt 0 ] && echo "… $zero zero-height image report(s) — check the page by eye" \
                  || echo "✓ no zero-height images"

for page in "${PAGES[@]}"; do
  # `grep -c`, not `grep -q`. Under `pipefail`, a `-q` grep exits at its first match
  # and the `printf` feeding it dies of SIGPIPE, so the *pipeline* reports 141 and the
  # page reads as failing — but only when the match isn't the last line, which is why
  # this looked like a broken app rather than a broken test.
  # Anchored so /outfits does not match a /outfits/new line.
  if [ "$(printf '%s\n' "$NEW" | grep -cE "GET ${page}(\?[^ ]*)? 200")" -gt 0 ]; then
    echo "✓ ${page} responded 200"
  else
    echo "✗ ${page} did not respond 200"
    STATUS=1
  fi
done

[ "$STATUS" -eq 0 ] && echo "all pages render" || echo "problems above — do not report this as done"
exit "$STATUS"
