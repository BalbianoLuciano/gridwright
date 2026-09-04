# Spec 002 — Corrections from the first end-to-end run

> Status: in progress · 2026-09-04
> Six of twelve are fixed; each one says so under its own heading.
> Amends `001-pipeline.md`. Everything here came out of running the pipeline
> end to end against a real Figma node for the first time, in a real consuming
> project. Nothing in this document is specific to that project.

## What happened

A component was built through every stage the pipeline has. It came out
visually correct — the perceptual diff against Figma's own export scored
**95.67%** — and the pipeline scored it **20.73%**, then **32.92%**, then
**66.07%** as three bugs in the measurement were fixed underneath it.

The number that matters is not any of those. It is this pair, on one render, in
one run:

| dimension | score |
|---|---|
| perceptual | 95.67% |
| structural | 48.93% |

Two rulers measuring the same object and disagreeing by 47 points. One of them
is broken, and the pipeline has no way to say which — it attributes the whole
gap to the component, every time.

**This run was phase 2's acceptance test**, arriving three phases late. Phase 2
was defined as "`verify` with Playwright, **on a hand-written component** —
metrics calibrated against something known good". That calibration never
happened; phases 3, 4 and 5 shipped on top of an uncalibrated ruler, and three
defects in it survived until a real component walked into them.

The spec predicted this in its own words — *the ruler first, then the factory* —
and the ordering was inverted anyway. That is the finding behind all the others.

---

## 1 — `distill` emits two trees and only one is a contract

> **Fixed.** Nodes carry their layer path through the walk, the measurements are
filtered to whatever survives `collapse()`, and the path is stripped before the
IR leaves. On a real node this removes the six levels of Figma instance plumbing
around one icon from the graded set.

**The defect.** `collapse()` prunes the IR: a container with a single child, no
layout of its own, no padding and no background is dropped. Its comment says
this is "the difference between a 120-line IR and a 400-line one", and it is
right.

But `ctx.measured` is filled *during* the walk, before the pruning. It is never
pruned. So:

- `author` builds from `ir.json` — pruned, semantic
- `verify` grades against `measurements.json` — unpruned, raw

The model is asked to build tree A and graded against tree B, and the difference
between them is exactly the set of nodes `collapse()` decided were meaningless.
Every node the pruning removes is a guaranteed zero in the structural dimension,
because the agent was explicitly told it did not exist.

**Why it is general.** The gap scales with how well the IR works. The better
`collapse()` gets, the lower a correct component scores. A quality improvement
in one half of `distill` is a regression in the other.

**Fix.** `measurements.nodes` derives from the pruned IR, not from the walk. One
tree, one contract. If a node is not in the contract, it is not graded.

---

## 2 — There is no declared identity between a design node and a rendered one

**The defect.** Structural matching paired `design[i]` with `rendered[i]` at the
same depth. One inlined `<svg>`, one wrapper div, and every pair after it shifts
— a button gets measured against an illustration's box, and the colour probes
follow the same wrong geometry.

The correspondence was never specified anywhere. It was inferred from tree
shape, which silently demands that the DOM mirror Figma's tree. A Figma
component instance arrives wrapped in its own plumbing: an icon in a real design
was six nodes deep — `sl-icon-santillana / sl-icon / SL-icon/md / Base/Icon /
icon-container / icon` — all sharing one 16×16 box. Nothing sane reproduces that
in JSX, and an agent chasing the score *will* try.

**Why it is general.** Any pipeline that grades generated code against a design
needs an explicit correspondence. Inferring it from structure means the metric
punishes exactly the idiomatic code the pipeline asks for elsewhere.

**Fix (done).** Match by layer path — which `MeasuredNode.path`'s own doc
comment already promised was "stable enough to match against a rendered tree" —
keyed by `path#occurrence`, because Figma allows sibling layers to share a name.
Matching is hybrid: identity where a `data-gw` label exists, reading order for
the rest, over what identity did not claim. Hybrid is not a compromise, it is
required: Figma names a text layer after its own contents, so the honest label
for a paragraph is the entire lorem passage.

**Still to do.** `verify` should refuse to report a score when coverage is low,
rather than reporting a meaningless one. See §5.

---

## 3 — Two of three viewports are graded against nothing

**The defect.** `scoreStructural` normalizes both boxes against their root, so
it measures *proportional similarity*. A responsive component — max-width plus
fixed padding — is not a proportional scale of anything. It cannot match at more
than one width, by construction.

A Figma frame has one width. The pipeline renders at three, and the worst
viewport decides the run. So the result is decided by the two measurements that
have no ground truth behind them.

The run does not record the design's native width anywhere. `state.json` has the
node id and the file key; nothing says "this frame is 1920 wide and that is what
it means".

**Why it is general.** Every desktop-only frame hits this. The same render
scored 37% at 1440 and 55% at 1920 — the delta is the metric, not the code.

**Fix.** Record the frame's native width on the run. Grade at that width. For a
viewport with no corresponding design frame, report `unavailable` rather than a
score — which is the principle Law 6 *already states* for dimensions:

> A missing dimension is reported, never scored as zero — a zero would say
> "wrong" when the truth is "unknown".

The same sentence applies to viewports, unchanged. Multi-breakpoint fidelity
needs one fetched frame per breakpoint; anything else is inventing a reference.

---

## 4 — Nothing can falsify the ruler

> **Fixed.** `inconsistency()` flags high perceptual against low structural, and
`refine` stops on it rather than spending an iteration. Only `--focus`
overrides.

**The defect.** `refine` attributes 100% of the gap to the component. Always. Its
iteration cap is spent editing code that may be correct.

The contradiction in §0 — perceptual 95.67%, structural 48.93%, one render — was
sitting in the output and nothing consumed it.

**Why this is the dangerous one.** A mis-measuring ruler makes an obedient agent
damage working code. The first instinct on seeing those deltas is to reshape the
DOM until they shrink, which here meant reproducing five nested instance
wrappers around an `<svg>`. The score would have gone up. The component would
have gotten worse. Nothing in the pipeline would have objected.

**Fix.** A cross-dimension consistency check before `refine` hands out work:
high perceptual with low structural means the *correspondence* is broken, not
the layout. Stop and say so. Do not spend an iteration.

---

## 5 — `author` submits blind

> **Fixed.** `DimensionScore.coverage` is reported, and below two thirds matched
the structural dimension returns `unavailable` instead of a figure.

**The defect.** The agent writes, then gets a number. There is no acceptance
criterion it can check before submitting, and no way to distinguish "this scored
low" from "this was not measurable".

**Fix.** Coverage is a precondition, not a score: *"12 of 17 IR nodes matched"*.
Below a threshold, `verify` reports that instead of a score. A number computed
over a broken pairing is worse than no number, because it looks actionable.

---

## 6 — A run that fails fidelity contributes nothing

**The defect.** Stages 4, 5 and 13 are declared mandatory — "they are the ones
that build the system". But `library:register` is stage 13, behind the `verify`
threshold and the `golden` gate. A run that scores below threshold can never
reach it.

In the run that produced this document: `library:ensure` scaffolded
`components/ui/` with a barrel and a registry, `author` wrote a real component,
and `registry.json` is `{}`. The barrel exports nothing.

**Why it is general.** It inverts the guiding principle. The spec says a
component that turns out fine but contributed nothing to the system means the
run failed. The pipeline enforces the converse: a component that contributed —
six resolved tokens, a survey, a plan — is discarded whole because one number
came in low.

**Fix.** Separate what accumulates from what is certified. Tokens are already
written before the score exists; the registry entry should be too, carrying the
score it achieved and no baseline. `golden` freezes a baseline — that is what
belongs behind the threshold. Being *known about* is not the same as being
*approved*, and only the second needs a gate.

---

## 7 — Colour probes cannot measure text

> **Fixed.** Probes carry which property holds their colour; text is read from
`getComputedStyle().color`. The IR field is still called `bg`, which is still
wrong for most of the nodes that carry one.

**The defect.** `scoreChromatic` samples one pixel at the centre of a node's
box. For a `TEXT` node the fill is the colour of the **glyphs**, and the centre
of a text box lands between them — so the probe reads the background. Same for a
stroked vector: the centre of a drawn envelope is empty.

Every chromatic failure in the run was this, five times: `#00554c → #e0f2f1`,
`#ffffff → #007a8d`. The component's colours were correct throughout.

**Why it is general.** Text is most of any design, and `bg` — the IR's name for
"first solid fill" — means foreground on every text node in every file.

**Fix.** Do not sample pixels for text. With identity matching in place, read
`getComputedStyle(el).color` on the paired element and compare by ΔE. Exact, no
sampling noise. Consider renaming the IR field: `bg` is wrong for the majority
of the nodes that carry it.

---

## 8 — The harness contract is undeclared

Three separate instances of the same shape: the harness requires things of the
consuming project that nothing states and nothing checks.

- It imports `@vitejs/plugin-react` / `@vitejs/plugin-vue`. Neither is a
  dependency of `@gridwright/verify`, which declares only `vite` and
  `playwright`. It works only if the project happens to have one.
- It mounts with `import Component from …`, so a named export renders nothing.
  The failure surfaces as an esbuild error about a missing `default` export,
  several layers below where the decision was made.
- It needs the project's dependencies installed. A project that has never run
  `npm install` fails inside Vite rather than at a precondition.

**Fix.** Adapters own harness mount code (Law 8, item 3), so they own its
requirements too: declare them, check them before starting the browser, and fail
with the remedy. The export shape belongs in the `author` directive, not in a
bundler stack trace.

---

## 9 — The dashboard is unreachable in practice, and unnavigable once reached

- `gw next` never names it. The loop walks stage to stage and the dashboard only
  appears if a run reaches stage 14 — so it is absent exactly when a run stalls,
  which is when it is most useful.
- Without `--run` it reports on `activeRun()`, the **newest** run. The newest run
  is always the least advanced, because `build` stops at the `tokens` gate. The
  default therefore produces "Not verified yet", zero images, 19KB. It looks
  broken.
- `--run` is not in the help text, which lists a bare `gw report`.
- The page is one long scroll: no nav, no anchors, nothing sticky.

**Fix.** Default to the most advanced run, not the newest. Have `gw next` name
the dashboard whenever a run stalls or fails. Document the flag. Give the page a
table of contents and per-viewport sections that can be linked to.

---

## 10 — The token writer downgrades computed tokens to literals

> **Fixed.** The writer refuses, names the expression it found, and hands the
decision back to the person at the gate.

**The defect.** A project declaring `brand.DEFAULT` as
`rgb(var(--sf-brand) / <alpha-value>)` had it overwritten with `#007a8d`. That
silently removes opacity support (`bg-brand/50`) and breaks the project's single
source of truth, which lived in a CSS file the writer never looked at.

**Why it is general.** `read.ts` already knows these values are `comparable:
false` — it records the indirection deliberately and documents why. The writer
does not consult that flag.

**Fix.** Never replace a computed token with a literal. When the matching token
is non-comparable, the choice belongs to the person at the `tokens` gate:
report the collision and let them route the value to the CSS file instead.

---

## 11 — Run artifacts have no version

Two runs created before a `distill` change became unreadable afterwards —
`gw resolve` reported "has no distilled values" and the only remedy was to
re-fetch. `state.json` carries `version: 1`; the artifacts beside it carry
nothing.

**Fix.** Version the run directory, and detect a stale one with a message that
names the fix. A run is a cache of a Figma fetch; invalidating it is fine,
failing three stages later is not.

---

## 12 — The `tokens` gate is asked for before there is anything to decide with

`tokens` is stage 4; `plan` is stage 7. A person is asked to name and approve
tokens before anyone has decided what the component is.

Law 4 requires tokens to be **resolved** before `author`, and it justifies that
well. It does not require them to be **approved** before `plan`. Moving the gate
after `plan` violates nothing and gives the decision its context.

Related, and cheap: the first run of this exercise asked for 15 names, of which
five were Tailwind's own defaults. That one is already fixed — the resolver now
loads the framework scale — but it is the shape to watch for. A gate that asks
for decisions that are not real spends the only budget the pipeline cannot
refill, which is the person's attention.

---

## Not in this document, found while fixing it

**The pipeline knew where a component goes and not how it is written.** A
project can have several shapes at once — santillanafrancais has three — and
they are not interchangeable: a module exporting `default` where the project
exports a named `Component`, or missing a `fields` its CMS requires, compiles,
renders in the harness, scores well and does not work in the product. Nothing
downstream catches it, because every check here is about fidelity to the design.
Shapes and convention docs are now inferred from the repo and reach the model at
`plan` and `author`.

## Suggested order

1. **§1** — measurements from the pruned IR. Fixes a whole class rather than a case.
2. **§5** — coverage as a precondition of `verify`.
3. **§3** — native width on the run; unscored viewports reported `unavailable`.
4. **§4** — the consistency check, before `refine` can send anyone to edit correct code.
5. **§6** — let a sub-threshold run still register what it contributed.
6. **§7** — computed colour for text probes.

The first two are expected to move the reference component from 66% into the
nineties without touching a line of it. That is also the test of whether this
diagnosis is right: if the number does not move, §1 was the wrong root cause.

## Already changed (uncommitted)

- `packages/core/src/score.ts` — identity matching (§2), with three tests.
- `packages/figma/src/distill.ts` — `collapsePassThrough()`, dropping nodes whose
  box equals their parent's. A partial, coincidental overlap with §1: it removes
  Figma's instance plumbing, but the real fix is deriving from the pruned IR.
- `plugin/claude-code/skills/pipeline/SKILL.md` — the `data-gw` labelling rule,
  including the warning not to chase the score by mirroring Figma's tree.
