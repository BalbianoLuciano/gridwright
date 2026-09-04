---
description: Show and explain the distilled IR of a gridwright run
argument-hint: [run-id]
---

Run `gw ir $ARGUMENTS` and walk through what came back:

- the layout it resolved, and whether it maps cleanly to flex with `gap`
- roles, slots and prop defaults it inferred
- any `warnings` — especially `absolute-positioning`, which means that part of
  the design has no recoverable layout

Judge the distillation honestly. If a heading level or a role looks wrong, say
so: those are declared heuristics and `plan` is where a human corrects them.
