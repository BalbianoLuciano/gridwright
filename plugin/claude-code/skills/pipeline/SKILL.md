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

## Closing `author`: the file and the props

```bash
gw done --output '{"file": "components/modules/NewsletterBanner/index.tsx",
                   "props": {"fieldValues": {"title": "…", "text": "…"}}}'
```

Both halves are needed and neither can be worked out downstream.

The **file** is what `verify`, `golden` and `library:register` all operate on.
Without it they ask for a `--component` flag, and the pipeline stops on a
question whose answer you had a moment ago.

The **props** are what mounts it. They cannot be derived from the IR: the IR
names the design's slots — `suscribeToOut`, `loremIpsumDolor` — and the
component names its props by whatever convention the project follows. Only you
know the mapping. Use the design's own copy, which is on each node's `default`
in the IR: a paragraph two lines long where the design has three moves every
box under it, and the score then reports a layout problem that is really a
copy problem.

A module rendered with no props returns null, and an empty render scores zero
for a reason that has nothing to do with the design.

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

## Building a whole view

```bash
gw build --view "<url of the page frame>"
```

Give it the page, never a list of its sections. gridwright takes the page's
immediate children, and that is the list: a hand-written one of a real page
missed three sections, included a background rectangle and named two nodes that
did not exist. Your part is to **confirm** the list with the person at `plan` —
`inputs.sections` has it — not to write it.

Each immediate child is one of four things, and `gw next` says which:

- **a section to build** — made from a library component; it has its own run
- **reused** — that component is already in the library
- **the same as another section** in this view — built once
- **part of the view** — drawn for this page; you build it inside the view, and
  it never goes to the library

The view does everything shared, once: tokens for the whole page (one gate),
the library's structure, and, at the end, registering every section in order.
That is what lets the sections run side by side.

**When the view reaches `author` and `gw next` lists `inputs.pending`, build the
sections in parallel** — one agent each, in the same tree, every stage from
`plan` to `golden`, and `--run <id>` on every command:

```bash
gw next --json --run <section-run>     # always --run: several runs are open
gw done --run <section-run> --output '{"file": "...", "props": {...}}'
gw verify --run <section-run>
gw golden --run <section-run>
```

Do not run the project's build from a section. Nine sections building at once
all write the same `dist/`, and one of them fails for a reason that has nothing
to do with its component. `tsc --noEmit` tells you your file compiles; `gw
verify` tells you it renders.

A section stops when `gw next --run` says its view closes it. Do not register a
section yourself: the registry and the barrel are one file each, and sections
writing them at once is exactly what the view exists to prevent. If a section's
`gw next` says it is waiting on its view, it is — its tokens are not written
yet.

Then compose the view. `inputs.sections` gives each section's file, or the
library component it reuses, and its `layerName` — the name the view's IR uses
for that box, which is often not the component's name (`home-signals` in the IR
is `OverlayForm` in the library). Put the IR's label on each section's wrapper,
like any other node. `gw done` refuses to close the view's `author` while a
section is unfinished.

## Asking the person: options, never open questions

Never ask the person to type an answer. Every question — a gate, a section list
to confirm, a placement, a name, a doubt of your own — goes through the
AskUserQuestion tool: two to four options, the one you recommend first and
marked as recommended, each saying what happens if it is picked. The tool always
adds an "Other" for the rare answer you did not foresee; that is where free text
belongs, not in your question.

The work of turning a decision into options is yours. At the tokens gate, do not
ask "what should these be called?" — propose names that follow the project's
convention, and ask:

- **Use these names** (recommended) — the list, as you would write them
- **Name them by role instead** — `ink`, `surface`, `accent` rather than a palette
- **Leave the near-duplicates out** — when two of them are within a shade of
  something the project has

When confirming a view's sections, offer "Build all ten as listed" against
"Leave some out". When `init` found two candidate directories for a kind, the
options are the two directories. A doubt with no obvious options is a sign you
have not done the work of finding them yet.

## A typeface the project does not load

When `gw build` warns that the design uses a family this project does not load,
that warning is the whole response. `inputs.missingFonts` lists them.

Do not pick a substitute, do not install a lookalike, and do not ask about it.
A commercial typeface is licensed and a lookalike is a different design; either
decision is the project's, and it belongs before a run. Use the project's font
utilities as they are, carry on, and mention the missing families once in your
report — the structural score is affected until they are loaded, and the person
should read it knowing that.

## Rules that hold at every stage

**A node's `tokens` are a specification, not a hint.** Every value in there was
measured off the design: `bg`, `type`, `radius`, `shadow`, `border`. Use each
one, or say why you did not. `resolve` has already matched them to the
project's own tokens, so the answer to "what colour is this card" is in the run,
not in your judgment.

This is the failure that has actually happened. A component was written with
`bg-white` where the IR said `bg: #e0f2f1`, and body text at 16px where the IR
said 20. Both values were sitting in the IR, both had already been resolved to
`tertiary-50` and `paragraph-lg`, and the component still scored in the forties
for two days. Reading the IR for structure and skipping its tokens produces
something that is shaped right and looks wrong.

**Reusing a project component does not carry the design's styles with it.**
`ui/Button` is the project's button, not necessarily this design's button.
Check its result against the node's tokens like anything else.

**And it will not carry your `data-gw` either.** A project primitive that does
not declare and forward the attribute drops it, and JSX accepts an undeclared
`data-*` on a component **with no type error** — it compiles, it renders, and
the label is simply not in the DOM. `verify` reports it as *not found in the
render* on a node you did label. The fix is one line in the primitive:

```tsx
// Props
'data-gw'?: string;
// and on the element it renders
data-gw={dataGw}
```

That is a change to a shared component, so say so when you make it.

**Use `conventions.breakpoints`, never Tailwind's defaults.** A project that
renames its screens has no `md:` or `lg:` — those are not smaller breakpoints,
they are classes that do not exist, and nothing errors. A component written
with them lays out as though it had no responsive rules at all. That has
happened too, in the same component: every `md:flex-row` in it was inert
because the project's breakpoints are `tablet`, `laptop`, `desktop` and `wide`.

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

**`inputs.placement` says where this goes, and what it is.** A header is not a
page module, a modal is not a page module, and a whole view is not one either
— but they all used to land in whichever directory had the most files in it.

```json
"placement": { "kind": "layout", "dir": "templates/partials" }
```

The kind comes from what the design is called, which is a heuristic and is
sometimes wrong. `plan` is the step where a person decides, so say what you
think it is and why: "the frame is called *Bandeau newsletter*, I read that as
a module, not a layout part". If nobody corrects you, use the directory you
were given.

`conventions.placements` holds the whole map, including the directories the
project does not have yet. One that does not exist is an intention, not an
error — create it when you have something to put in it.

**Write the code this repo would write.** `inputs.conventions` carries the
shapes found in the project — where each kind of component lives, how its file
is laid out, how it exports, and what else every file of that kind exports.
Follow the one that matches where the component is going, and open its `example`
before writing. In a shape's `file`, `{Name}` is the PascalCase name and
`{name}` its kebab-case spelling: `{name}/{Name}.vue` means
`dialog-header/DialogHeader.vue`.

A shape is not a style preference. A module that exports `default` where the
project exports a named `Component`, or that omits a `fields` its CMS requires,
will compile, render in the harness, score well **and not work in the product**.
Nothing downstream catches that: every check in this pipeline is about fidelity
to the design.

Read `conventions.docs` too. They hold the rules no amount of looking at file
shapes will find.

**No margins between siblings.** Use `gap`. The IR cannot express margins, so
if you are reaching for one you have left the IR behind.

**Copy each node's `label` into `data-gw`, character for character.** Every
node in the IR carries one — `WrapperWide`, `CallToActions`, `Content2`. It is
not the layer name and it is not a suggestion: it is the only thing the two
sides agree on, and `verify` matches on it exactly.

```tsx
// ir.json says  { "label": "Content2", "role": "container", … }
<div data-gw="Content2" className="flex …">
```

Do not rename it because it reads badly. Figma gives siblings the same name —
one real frame had two containers both called `Content`, so the IR issued
`Content` and `Content2` in document order. Reading them as a tree tells you
which is which: `Content` is the first child of `CallToAction`, `Content2` the
second. Writing `Vector` on the first and `Content` on the second, which is
what the names looked like from the outside, matched the content row against
the illustration's box and reported it 648px too wide. Nothing about that
finding pointed at the label.

Without labels `verify` falls back to pairing by depth and reading order, which
breaks on any component worth writing: one inlined `<svg>` or one wrapper div
shifts every pair at that depth. Do not chase that score by reshaping the DOM
to mirror Figma's tree — a Figma button carries six levels of
component-instance wrappers, and reproducing them is the failure, not the fix.

Label what the design measures: containers, headings, text, buttons, images.
Skip your own presentational wrappers — extra elements cost nothing.

**You are not expected to reproduce what lives inside a component you reuse.**
Figma draws a button as a frame holding a padding frame holding a text node
beside an icon; you write `<Button label={…} />`. `verify` sees that the
subtree collapsed and excludes it — it reports those nodes as `collapsed`, not
as missing, and they do not count against coverage.

**Figma copy becomes prop defaults**, not hardcoded markup. The component stays
presentational: no fetching, no stores, no business logic.

## Reporting

State the score and what failed, never a summary that sounds better than the
run went. If `verify` came back at 71% structural, say 71% and name the nodes
that moved. A run that stopped early stopped early — say which stage and why.
