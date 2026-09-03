# Spec 001 — The pipeline

> Status: under review · 2026-09-03
> Defines what gridwright is and the rules that govern every stage.
> Any implementation decision that contradicts a law here is wrong.

## Guiding principle

**The design comes in as a node and leaves as a system.**

Gridwright does not generate components. It builds the project's design system
one Figma node at a time. Every run leaves the project with more resolved
tokens, more registered components and more verified surface than before. A
component generator produces files; gridwright produces accumulation.

Everything else follows from that: if a component turns out fine but
contributed nothing to the system, the run failed.

---

## Law 1 — The workflow is state on disk, not text in a prompt

The state machine lives in `.gridwright/runs/<id>/state.json` and the CLI
enforces it. Claude Code does not decide which stage comes next: it asks `gw`.

```
$ gw next
{
  "run": "hero-about-us-01",
  "stage": "author",
  "action": "write the component",
  "inputs": { "ir": "...", "reference": "...", "reuse": [...] },
  "gate": "run `gw verify`. No advancing without passing."
}
```

**Why this is a law and not a preference.** The opposite has already been
tried. An earlier project has a five-phase workflow written in prose, and the
agent skips the similarity-analysis phase every time the request looks simple.
A prompt is a suggestion; a long prompt is a suggestion that also dilutes as
context grows. A state machine cannot be ignored, because it is not persuasion —
it is control flow.

Consequences:

- The state survives session interruptions, compaction and restarts.
- No stage can be skipped, not even "because this case is simple".
- The CLI is the single source of truth about where a run stands.
- If a stage does not apply, the CLI marks it `skipped` with a reason. It does
  not vanish.

---

## Law 2 — The raw Figma tree never reaches the LLM

The **IR** always sits between Figma and Claude. The raw tree of a frame is
2,000 to 5,000 nodes with absolute coordinates, nested fills, constraints and
effects. The IR is its semantic distillation: about 120 lines.

**Why.** Feeding the raw tree into the context is not merely expensive: it
produces *worse* results. The model drowns in noise, latches onto the
`absoluteBoundingBox` values it can see, and writes `position: absolute`. Less
information, well chosen, produces better code than more raw information.

### IR format

```json
{
  "name": "HeroAboutUs",
  "source": { "file": "D7qfUlKn...", "node": "3978:35299" },
  "layout": { "kind": "flex", "dir": "col", "gap": 24, "align": "center" },
  "tokens": { "bg": "surface.primary", "pad": "space.12" },
  "children": [
    { "role": "image", "asset": "hero-about-us.png", "ratio": "16/9" },
    { "role": "heading", "level": 1, "token": "text.display",
      "slot": "title", "default": "About us" }
  ],
  "variants": { "size": ["sm", "lg"] },
  "warnings": ["3 absolutely positioned nodes — layout not inferable"]
}
```

### Two translations that are isomorphisms, not heuristics

**Auto-layout is flex with gap.** `layoutMode` + `itemSpacing` +
`primaryAxisAlignItems` map one to one onto `flex-col gap-6 justify-*`. There is
no inference involved. A valuable side effect: gridwright **cannot** generate
margins between siblings, because Figma never gives it that information. The
rule enforces itself.

**Figma variants are props.** A component with `Size=Large, State=Hover` hands
over the prop matrix without anything being invented.

### The uncomfortable corollary

If the Figma does not use auto-layout, there is no layout to extract. A better
prompt will not fix that. `distill` detects it, puts it in `warnings`, and halts
past a threshold. **Halting beats emitting two hundred lines that merely look
right.**

---

## Law 3 — Everything measurable is deterministic; the LLM only does what cannot be measured

| Code | LLM |
|---|---|
| Pull the node, the assets, the reference image | Write the component idiomatically for this repo |
| Distill into the IR | Name things, decide the prop API |
| Match and classify tokens | Name the new tokens following the convention |
| Index existing components | Decide what to reuse |
| Render, measure, diff | Read the diff and fix it |
| Write tokens, barrel, registry, dashboard | |

If a task can be checked with an assert, the model does not do it. If it needs
judgment about the code that already exists, the program does not do it.

---

## Law 4 — Tokens are written before the component

Mandatory order: `resolve` → `tokens` → `author`.

**Why.** If Claude writes the component before the tokens exist, it writes
`bg-[#1A1A1A]` and someone has to refactor afterwards. With the tokens already
in the system it writes `bg-surface-primary` on the first attempt. The ordering
is what makes the output use tokens instead of magic values.

### Matching with tolerance

| Type | How it is matched | Why |
|---|---|---|
| Colour | **ΔE (CIEDE2000) ≤ 1.0** | `#1A1A1B` and `#1A1A1A` are the same colour to the eye. Matching on hex equality creates a new token and starts the rot. |
| Spacing | Exact, or snapped to the existing scale | If the scale is 4/8/12/16 and the design says 14, that **is not a new token, it is a design bug**. Report it, do not absorb it. |
| Typography | The tuple `family + weight + size + lineHeight` | A size without its line height is not a token, it is a loose value. |

### The three buckets

- **`exact`** — use the existing one. Silence.
- **`near`** — use the existing one **anyway**, and report the drift:
  *"the design brings `#1A1A1B`, the system has `#1A1A1A` (ΔE 0.4). Used the
  system's."* This bucket is what saves the design system.
- **`new`** — propose a new token. Subject to the gate in Law 5.

### Writing

1. **Find where tokens live by looking for the existing ones**, not by checking
   a tool version. A project can run Tailwind 4.1 *and* have a
   `tailwind.config.js` with `theme.extend`. The real world mixes them. Shapes
   to support: v3 JS config, v4 `@theme` block, CSS custom properties, SCSS.
2. **AST, never regex.** `ts-morph` for the JS config, `postcss` for CSS. It is
   a shared project file: one bad regex breaks the build for everyone.
3. **Always report** the diff in the dashboard, even when the gate approved it.

---

## Law 5 — Nothing that mutates the project is written without approval

Three human gates, and they are the only points where the pipeline waits:

| Gate | When | What is approved |
|---|---|---|
| **`plan`** | before any code is written | structure, props, what gets reused |
| **`tokens`** | before touching the system | the `new` bucket, with their names |
| **`golden`** | before freezing | the baseline and the regression test |

The tokens stage **always runs** — it is mandatory, not optional — but the
*write* shows the diff and waits.

**Why a gate on tokens rather than trust.** A badly generated component is
rewritten in ten minutes. A contaminated token system is inherited forever:
`neutral-900`, `neutral-900-alt`, `neutral-901`, and six months later nobody
knows which one to use. The asymmetry in reversibility justifies the friction.

*The system generates, the person decides.*

---

## Law 6 — Pixel-perfect against Figma is a mirage

Figma's text engine and Chromium's differ in kerning, hinting and antialiasing.
A **perfect** component comes out 3–8% different at the pixel level. A raw diff
threshold at 1% is never reached; at 10% anything passes.

The score is composite and weighted:

| Dimension | Weight | How it is measured | Noise |
|---|---|---|---|
| **Structural** | 50% | bounding boxes of the main nodes, ±2px tolerance | none |
| **Chromatic** | 25% | colour sampled at defined points, ΔE | none |
| **Perceptual** | 25% | pixel diff with a mask over text regions | high |

- **Passing threshold: 90%.**
- Measured per viewport, and the final score is **the worst viewport, not the
  average**. If it breaks on mobile, it is broken.
- Structural carries half because it is the only dimension without rendering
  noise and the one that catches real layout errors.

### Refine is not "try again"

`gw refine --focus=<dimension>` hands Claude *what* failed and *where*:

```
Structural 71% — failing on mobile (375px):
  • [heading]   top: expected 148, got 156  (+8px)
  • [container] gap: expected 32,  got 24
  • [image]     height: expected 240, got 240  ✓
Chromatic 100% ✓    Perceptual 94% ✓
```

That converges in two iterations. A red blob never converges. **Hard cap of 4
iterations**: if it does not get there, stop and show the dashboard.

---

## Law 7 — Two kinds of verification, never mixed

**Fidelity** — does it look like the design? An acceptance gate, measured once,
during construction, against the image exported from Figma. **Not a permanent
test**: the Figma will change, and the real component will carry real data, not
the mockup's lorem.

**Regression** — once approved, the screenshot **of the component itself**
becomes a baseline in the repo. *That* one runs in CI forever.

The first asks "did I build it right?". The second asks "did I break it?".
Conflating them produces a suite that fails every time a designer moves a frame.

---

## Law 8 — The adapter boundary is sacred

A framework adapter owns **five things and only five**:

1. File shape (`.vue` SFC / `.tsx`)
2. Library scaffold and barrel syntax
3. Harness mount code (`createApp` / `createRoot`)
4. A prompt fragment covering the framework's idioms
5. Test file shape

**It does not touch**: the IR, resolve, tokens, verify, the dashboard, the state
machine.

> If an adapter needs to touch anything on that list, the boundary is drawn
> wrong, and the fix goes to the boundary, not the adapter.

Day-one adapters: **Vue 3 SFC** and **React 19**, both with Tailwind. Vue comes
first because there is a real project to dogfood against from phase 2 onward.

If the IR is right, an adapter is about 200 lines. Its being short is the proof
that the IR is right.

---

## Law 9 — Every tunable rule is data

These go in `gridwright.config.json`, never in code:

- token map and location
- thresholds for the three metrics and the score
- viewports
- ΔE and bounding-box tolerances
- file and asset naming
- library paths
- refine iteration cap

Changing the fidelity threshold must not require touching the diff algorithm.

---

## Law 10 — The secret does not pass through the model

Gridwright needs a **Figma personal access token**. Without it `fetch` does not
exist and the whole pipeline is decorative. Three rules on how it is handled.

### 10.a — The person types it, in their terminal, never through Claude

The pipeline runs inside a Claude Code session. If Claude runs the command that
asks for the token, or if the token appears in a message, it ends up in the
transcript, in the context, in the logs and eventually in persistent memory. A
secret that went through the LLM has to be treated as compromised.

**The skill never runs `gw auth login`.** When credentials are missing, Claude
stops and tells the person to run it themselves:

```
Missing Figma token. Run this in your terminal:

    ! gw auth login

(the `!` prefix runs it in your shell, outside the conversation)
```

`gw auth login` reads the token from **hidden stdin**. It does not accept it as
an argument — `gw auth login --token=figd_xxx` does not exist, because an
argument lands in the shell history and in the process list.

### 10.b — It lives once per machine, not once per project

`gw` is a global binary used across many repos. Putting the token in each
project's `.env` forces pasting it N times and multiplies the odds of
committing it by N.

Resolution order, first match wins:

| Source | For |
|---|---|
| `FIGMA_TOKEN` in the environment | CI, and as an escape hatch |
| the project's `.env` | a project with its own token (different team) |
| `~/.config/gridwright/credentials.json`, mode `0600` | **the normal case** |

Never in `gridwright.config.json`: that file is committed.

### 10.c — The token touches no run artifact

Not `state.json`, not the IR, not the manifest, not the dashboard, not the logs.
If an error message has to mention it, it goes masked (`figd_…a3f2`). Figma
serves assets from temporary signed URLs: **those are not persisted either**,
because they are credentials with legs.

### Validate on save, not on use

`gw auth login` hits `GET /v1/me` before writing anything and confirms which
account it landed on:

```
✓ Token valid — you@example.com
  Saved to ~/.config/gridwright/credentials.json
```

Saving an invalid token and discovering it three stages later is the worst
possible UX. Fail at second zero.

Minimum scopes: **`file_content:read` and `file_dev_resources:read`**.
Gridwright only reads. If the token carries write permissions, `gw auth` says so.

### The confusing Figma errors

| Code | What it looks like | What it usually is |
|---|---|---|
| `403` | invalid token | valid but expired token, or one without the read scope |
| `404` | the file does not exist | **the file exists but the token has no access** — it lives in a team the account does not belong to |
| `429` | failure | rate limit: retry with exponential backoff, not an error |

The `404` wastes the most time. When it happens, the message has to say *"the
node does not exist **or** your account has no access to that file"*, not just
the first half.

### A precondition, not a stage

Credentials are checked in `gw next`, before the stage is resolved. If they are
missing, the run never starts: there is no point leaving a half-created run
behind only for it to die in `fetch`. A run that cannot be completed is not
opened.

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│  SHELL — Claude Code plugin                                │
│  commands/  skills/  hooks/  .mcp.json                     │
│  Thin, no logic. It only teaches the `gw next` protocol.   │
└────────────────────────┬───────────────────────────────────┘
                         │
┌────────────────────────▼───────────────────────────────────┐
│  ENGINE — `gw` CLI  (TypeScript / Node)                    │
│                                                             │
│  @gridwright/core       state machine, types, IR            │
│  @gridwright/figma      API, traversal, assets, distill     │
│  @gridwright/tokens     match, classify, write back         │
│  @gridwright/library    scaffold, barrel, registry          │
│  @gridwright/verify     Playwright, metrics, diff           │
│  @gridwright/adapters   vue3 · react19                      │
│  @gridwright/dashboard  static report                       │
│  @gridwright/cli        the `gw` binary                     │
└────────────┬───────────────────────────┬───────────────────┘
             ▼                           ▼
   .gridwright/runs/<id>/         the consuming project
   state · IR · screenshots       components · tokens · tests
```

**Stack**: TypeScript, Node, pnpm workspaces. Vitest for the core, Playwright
for verify, `sharp` for assets, `odiff` for the perceptual diff, `ts-morph` and
`postcss` for the write-back.

**Distribution**: standalone repo. `npm i -g @gridwright/cli` for the binary;
`/plugin marketplace add BalbianoLuciano/gridwright` for the shell.

---

## The stages

| # | Stage | Who | In → Out | Gate |
|---|---|---|---|---|
| — | `auth` | **the person** | hidden stdin → `~/.config/gridwright/` | precondition, once per machine |
| 0 | `init` | human | repo → `gridwright.config.json` | once per project |
| 1 | `fetch` | code | Figma URL → tree + reference + assets | — |
| 2 | `distill` | code | tree → `ir.json` | halts if the IR comes out poor |
| 3 | `resolve` | code | IR + system → exact / near / new | — |
| 4 | `tokens` | code + LLM | new → tokens written | **human** |
| 5 | `library:ensure` | code | — → library exists | **human, first time** |
| 6 | `survey` | code | repo → reuse candidates | — |
| 7 | `plan` | Claude | IR + candidates → file plan | **human** |
| 8 | `author` | Claude | plan → code | — |
| 9 | `harness` | code | component → ephemeral Vite | — |
| 10 | `verify` | code | render → score per viewport | score ≥ 90 |
| 11 | `refine` | Claude | focused diff → fixes | cap of 4 |
| 12 | `golden` | you | approved → baseline + test | **human** |
| 13 | `library:register` | code | → barrel + `registry.json` | — |
| 14 | `report` | code | everything → dashboard | — |

`auth` is not a stage: it is a **precondition**. It has no number because it is
not part of a run, and `gw next` checks it before opening one (Law 10).

Mandatory without exception: **4, 5, 13**. They are the ones that build the
system. The rest can be marked `skipped` with a reason; those three cannot.

---

## The library

When it does not exist, `library:ensure` scaffolds the bare minimum:

```
src/components/ui/
├── index.ts          export barrel
└── registry.json     generated, machine-readable
```

Nothing else. **Deliberately unintrusive**: it drops into an existing repo
without fighting its structure. No `packages/ui`, no restructuring anyone's
project.

### The registry

```json
{
  "HeroAboutUs": {
    "path": "src/components/ui/HeroAboutUs.vue",
    "figma": { "file": "D7qfUlKn...", "node": "3978:35299", "irHash": "a3f2..." },
    "props": ["title", "description", "image"],
    "tokens": ["surface.primary", "text.display", "space.12"],
    "baseline": ".gridwright/baselines/HeroAboutUs.png",
    "score": 94,
    "runs": 3
  }
}
```

It does three jobs at once:

1. It is what `survey` reads to know what can be reused.
2. It feeds the dashboard's history.
3. It provides **idempotency**: the same Figma node twice is recognized by
   `irHash` and offered as an update rather than a duplicate. Without it, two
   months later you have `HeroAboutUs`, `HeroAboutUs2` and `HeroAboutUsNew`.

It is the hand-written component registry other projects keep, except generated.
The prose kind goes stale the day somebody is in a hurry. This one cannot.

---

## Content

The component is **purely presentational**. Figma's copy becomes the props'
default values and the harness fixture:

```vue
<script setup lang="ts">
defineProps<{ title?: string; description?: string; image?: string }>()
</script>
```

with `title = "About us"` as the default. That way the component renders on its
own in the harness and the showcase, but drags no copy along when a view
composes it.

No data fetching, no stores, no business logic. That lives in the view.

---

## Component vs view

Same pipeline, **one stage apart**: `survey`.

- **Component** — one node, one file. Variants become props. No composition.
- **View** — composition. `survey` is mandatory: without it you generate a view
  that reimplements the button, the card and the hero you already had, and six
  views later the project is a mess.

That is why view mode comes last: **a view without survey is worse than no view
mode at all.**

---

## Dashboard

Static, in `.gridwright/dashboard/`. No server, no build step.

- Figma / render / diff side by side, per viewport
- The IR, collapsible
- Tokens: exact, near (with the drift), new (with what was written)
- Warnings from distill
- The generated code, with the refine iterations
- History: iterations per component, which metric always fails

**The history is what makes the system improve.** If 80% of runs fail on the
same dimension, there is a rule to add to the config — not a prompt to tweak.

---

## Development phases

| Phase | What gets built | Verified by |
|---|---|---|
| **0** | This spec | approval |
| **1** | CLI + state machine + `fetch` + `distill` | the IR against real fixtures |
| **2** | `verify` with Playwright, **on a hand-written component** | metrics calibrated against something known good |
| **3** | Claude Code plugin + `author` + `refine` | the loop closes |
| **4** | `tokens` + `library` + `golden` + dashboard | the system accumulates |
| **5** | View mode: `survey` + composition | real reuse |

### Why phase 2 comes before phase 3

This is the counter-intuitive ordering, and the important one. **If you cannot
measure, you cannot close the loop.** A generative pipeline without a calibrated
metric is a text generator with extra steps: there is no way to tell whether it
got better or worse.

The ruler first, then the factory.

---

## Non-goals

- It does not generate design. It translates the design that exists.
- It does not fix a badly built Figma. It detects and reports it.
- No data fetching, routing or business logic.
- It does not chase pixel-perfect. It chases 90% with structural at half.
- It does not publish, commit or push anything on its own.

---

## Known risks

| Risk | Mitigation |
|---|---|
| Fonts: a raw diff gives 3–8% on a perfect render | composite metric, structural at 50% (Law 6) |
| Figma without auto-layout → poor IR | `distill` detects and halts, never guesses (Law 2) |
| Refine burns tokens without converging | `--focus` + a hard cap of 4 (Law 6) |
| Token explosion | ΔE + the `near` bucket + a human gate (Laws 4 and 5) |
| Near-duplicate components | `irHash` in the registry → idempotency |
| The Figma token leaking into the transcript or memory | the person types it in their shell, never via Claude (Law 10.a) |
| Signed asset URLs persisted in the run | consumed and discarded, never stored (Law 10.c) |
| `survey` is a genuinely hard problem | it goes last; starts heuristic (names + IR structure), embeddings later if needed |
