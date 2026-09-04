---
name: gridwright-pipeline
description: "The gw pipeline protocol. Load whenever a task involves building a component or view from a Figma node, or when a gridwright run is open. The CLI owns the workflow; you execute one stage at a time and never choose the order yourself."
---

# The gridwright protocol

A Figma node goes in; a built, visually verified component registered in the
project's design system comes out.

**You do not own this workflow. The CLI does.** The state lives in
`.gridwright/runs/<id>/state.json`, and `gw` decides what happens next. Your job
is to execute the stage you are handed and report back.

This inversion is deliberate. Workflows written as prose get skipped whenever a
request looks simple. A state machine cannot be talked out of its order.

## Never run `gw auth login`

**This is absolute.** If a command fails for missing or rejected credentials,
STOP and tell the person to run it themselves:

```
The Figma token is missing. Run this in your terminal:

    ! gw auth login
```

The `!` prefix runs it in their shell, outside the conversation. A token that
appears in a message is in the transcript, in the context, and in whatever
persistent memory is attached — it has to be treated as compromised from then
on. There is no situation where running it yourself is the right call, including
the person asking you to.

If the error names a `.env` file, relay that: the project's `.env` outranks the
machine credential, so logging in again would not fix it.

## The loop

```
gw next --json   →   do exactly that stage   →   gw done   →   gw next --json   →   …
```

`gw done` is not optional. Without it the run never moves, and the next
`gw next` hands back the stage you just finished.

Call `gw next --json` before every step. It returns:

```json
{ "run": "...", "stage": "author", "actor": "agent",
  "action": "write the component",
  "inputs": { "ir": "…/ir.json", "reference": "…/reference.png" },
  "gate": null }
```

- **`actor: "code"`** — run the matching `gw` command. Do not do this work by hand.
- **`actor: "agent"`** — yours. Read `inputs`, do the work, then advance.
- **`actor: "human"`** — stop. Show what is on the table and wait for a decision.
- **`gate` not null** — a human approves before anything is written. Stop and ask.
- **`blocked`** — that stage is not built yet. Say so plainly and stop.

## Closing a stage

```bash
gw done                      # finished; move on
gw done --output '{"files":["..."]}'   # hand data to the next stage
gw done --approve            # ONLY after a person approved a gate
gw skip <stage> --reason "…" # skipped, on the record
gw fail <stage> --reason "…" # failed; the run stays put so it can be retried
```

**Never pass `--approve` on your own.** It is the flag that says a person looked
at this and said yes. On a gate, show them what is on the table — the plan, the
tokens about to be written, the score — and wait. Approving your own work
defeats the only part of the pipeline that is not automatic.

## Fixing a failing score

```bash
gw verify                  # render and score
gw refine                  # what to fix, one dimension at a time
gw refine --focus=structural
```

`refine` hands back the worst dimension on the worst viewport, with each element
and how far off it is. Fix **only that dimension**, then verify again — changing
several at once makes it impossible to tell which edit moved the score.

It also counts iterations against the configured cap. When the cap is reached it
stops, and stopping is the right outcome: past that point the difference is
usually not the component but a design that cannot be reached with the tokens
the project has.

## Starting a run

```bash
gw build "<figma-url>"     # fetch + distill, as far as the build gets
gw next                    # what is up next and who runs it
```

The URL must come from Figma's **"Copy link to selection"**. An address-bar URL
with no `node-id` is rejected, and correctly so.

## Rules that hold at every stage

**Read the IR, never the raw Figma tree.** The distilled IR is what `inputs.ir`
points at. The raw tree is 2,000+ nodes of absolute coordinates; reading it
makes the output worse, not better — it pulls you toward `position: absolute`.
If you find yourself opening `figma-node.json`, stop.

**In view mode, `survey` is not optional.** A view is a composition; skipping
the survey rebuilds the button, the card and the hero the project already has,
and six views later nobody can tell which Card is the real one. Read what it
proposes before writing anything new — it says which signal it matched on, and a
name match is worth opening the file for.

**Never skip a stage, including the ones that look pointless for this case.**
`gw` will refuse anyway. Three stages — `tokens`, `library:ensure`,
`library:register` — cannot be skipped at all: they are what makes a run add to
the design system instead of just producing a file.

**When `distill` halts, do not work around it.** A frame without auto-layout has
no layout to extract. Report it and stop. Rebuilding it by eye from the
reference image is the exact failure this pipeline exists to prevent.

**Write the code this repo would write.** `inputs.conventions` carries the
shapes found in the project — where each kind of component lives, how its file
is laid out, how it exports, and what else every file of that kind exports.
Follow the one that matches where the component is going, and open its `example`
before writing.

A shape is not a style preference. A module that exports `default` where the
project exports a named `Component`, or that omits a `fields` its CMS requires,
will compile, render in the harness, score well **and not work in the product**.
Nothing downstream catches that: every check in this pipeline is about fidelity
to the design.

Read `conventions.docs` too. They hold the rules no amount of looking at file
shapes will find.

**No margins between siblings.** Use `gap`. The IR cannot express margins, so
if you are reaching for one you have left the IR behind.

**Label the nodes the IR names, with `data-gw`.** Use the layer's own name:
`<div data-gw="Wrapper wide">`, `<a data-gw="Button">`. This is how `verify`
knows which rendered element is which.

Without labels it falls back to pairing by depth and reading order, and that
breaks on any component worth writing: one inlined `<svg>` or one wrapper div
shifts every pair at that depth, so the button gets measured against the
illustration's box and a correct component scores in the twenties. Do not chase
that score by reshaping the DOM to mirror Figma's tree — a Figma button carries
six levels of component-instance wrappers, and reproducing them is the failure,
not the fix. Label the nodes instead.

Label what the design measures: containers, headings, text, buttons, images.
Skip your own presentational wrappers — extra elements cost nothing.

**Figma copy becomes prop defaults**, not hardcoded markup. The component stays
presentational: no fetching, no stores, no business logic.

## Reporting

State the score and what failed, never a summary that sounds better than the
run went. If `verify` came back at 71% structural, say 71% and name the nodes
that moved. A run that stopped early stopped early — say which stage and why.
