---
description: Build a component or view from a Figma node through the gw pipeline
argument-hint: <figma-url> [--view]
---

Build `$ARGUMENTS` through the gridwright pipeline.

Follow the `gridwright-pipeline` skill. In short:

1. `gw build "$ARGUMENTS"` — opens the run, fetches and distills.
2. `gw next --json` after every step, and do exactly the stage it names.
3. Stop at any `gate`, at any `human` actor, and at anything `blocked`.

If the URL has no `node-id`, ask for one copied with Figma's
**"Copy link to selection"** — the address-bar URL does not carry it.

If credentials are missing or rejected, **do not run `gw auth login` yourself**.
Tell the person to run `! gw auth login` in their terminal.
