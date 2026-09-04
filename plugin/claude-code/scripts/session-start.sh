#!/bin/bash
# Gridwright — SessionStart hook.
#
# A run is state on disk, so it outlives the session that opened it. Without
# this, coming back the next day means rediscovering that something was left
# half-built in `author`.
#
# Silent unless there is genuinely an open run: a hook that talks on every
# session start in every project stops being read.

cat > /dev/null   # drain the hook payload; we only need the cwd we already run in

command -v gw >/dev/null 2>&1 || exit 0
[ -d ".gridwright/runs" ] || exit 0

OUT=$(gw next --json 2>/dev/null) || exit 0
case "$OUT" in
  *no-active-run*|'') exit 0 ;;
esac

RUN=$(printf '%s' "$OUT"  | sed -n 's/.*"run"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
STAGE=$(printf '%s' "$OUT" | sed -n 's/.*"stage"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
ACTOR=$(printf '%s' "$OUT" | sed -n 's/.*"actor"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
[ -n "$RUN" ] || exit 0

WHO="the CLI"
[ "$ACTOR" = "agent" ] && WHO="you"
[ "$ACTOR" = "human" ] && WHO="the person, not you"

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' \
  "Gridwright: run '$RUN' is open at stage '$STAGE', owned by $WHO. Run \`gw next\` before doing anything with it, and follow the gridwright-pipeline skill. Do not run \`gw auth login\` under any circumstance."
