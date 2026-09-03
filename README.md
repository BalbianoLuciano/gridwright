# Gridwright

End-to-end layout pipeline. A Figma node goes in; a built, visually verified
component registered in the project's design system comes out. Driven from
Claude Code.

> **The design comes in as a node and leaves as a system.**
>
> Gridwright does not generate components: it builds the project's design system
> one node at a time. Every run leaves the repo with more resolved tokens, more
> registered components and more verified surface. If a component turns out fine
> but contributed nothing to the system, the run failed.

**Status: phase 1 of 5.** `fetch` and `distill` work. The remaining stages exist
in the state machine and are reported explicitly as not built, rather than
pretending they ran. See the [roadmap](#roadmap).

---

## The idea

The obvious temptation is to write a long prompt explaining to an agent how to
build a layout. That has been tried: an earlier repo has a five-phase workflow
written in prose, and the agent skips the analysis phase every time the request
looks simple. **A prompt is a suggestion.**

Gridwright inverts the split. The state machine lives on disk and a CLI enforces
it. Claude does not decide which stage comes next: it asks.

```console
$ gw next --json
{
  "run": "hero-about-us-01",
  "stage": "author",
  "actor": "agent",
  "action": "write the component",
  "inputs": { "ir": "…/ir.json", "reference": "…/reference.png" },
  "gate": null
}
```

Claude does the creative part, writes files and runs `gw verify`. If the gate
fails, the stage is still `refine`. There is no way to jump to `golden` without
passing, because the CLI will not allow it. If the session drops, the state is
still in `.gridwright/runs/<id>/state.json`.

The split is explicit:

| Code does this | The model does this |
|---|---|
| Pull the node, the assets and the reference | Write the component idiomatically for this repo |
| Distill the tree into the IR | Name things, decide the prop API |
| Match and classify tokens | Name the new tokens |
| Index existing components | Decide what to reuse |
| Render, measure, diff | Read the diff and fix it |

If it can be checked with an assert, the model does not do it. If it needs
judgment about code that already exists, the program does not do it.

---

## Install

```bash
npm i -g @gridwright/cli     # the engine
gw auth login                # once per machine
```

**You type the Figma token yourself, in your terminal.** Never through the
agent: once it is in a message it is in the transcript, in the context and in
persistent memory, and has to be treated as compromised. Inside Claude Code, the
`!` prefix runs in your shell, outside the conversation:

```
! gw auth login
```

`gw auth login` reads from hidden stdin and validates against the API before
saving anything, to `~/.config/gridwright/credentials.json` with mode `0600`.
There is no `--token` flag: an argument lands in the shell history and in `ps`.

---

## Usage

In the repo where the component will live:

```bash
gw init                      # detects framework, tokens and library. Once.
gw build "https://www.figma.com/design/<KEY>/<name>?node-id=3978-35299"
```

`gw init` does not ask what it can find out. The framework comes from
`package.json`, and the token destination is **searched for** rather than
assumed: there are projects on Tailwind 4 that still declare their tokens in a
legacy `tailwind.config.js`. "Which version do you have installed" and "where
are your tokens declared" are different questions.

```console
$ gw build "https://www.figma.com/design/D7qf…?node-id=3978-35299"
✓ Run hero-about-us-01 — frame "Hero About Us" → HeroAboutUs
→ 3 assets
    · hero-about-us.png 1440x405 · trimmed 1440x512 → 1440x405
→ IR: 4 nodes, 6 raw values (312KB → 4KB, 99% smaller)
    hash a3f2c1d4e5b6
```

| Command | |
|---|---|
| `gw build <url>` | opens a run and executes as far as it goes |
| `gw next [--json]` | which stage is up and who runs it — **the protocol** |
| `gw status` | runs and the stage each one is on |
| `gw ir [<run>]` | prints the IR |
| `gw auth status` | which credential is in use and where it came from |

---

## The IR

The raw tree of a frame is 2,000 to 5,000 nodes. Feeding it to the model is not
just expensive: it produces **worse** results, because the model latches onto
the `absoluteBoundingBox` values it sees and writes `position: absolute`. The
distillation always sits between Figma and the model.

```json
{
  "name": "HeroAboutUs",
  "layout": { "kind": "flex", "dir": "col", "gap": 24, "align": "center" },
  "tokens": { "bg": "#1a1a1a" },
  "children": [
    { "role": "image", "name": "Hero Background", "asset": "hero-background.png", "ratio": "32/9" },
    { "role": "heading", "level": 1, "slot": "title", "default": "About us" }
  ],
  "warnings": [],
  "hash": "a3f2c1d4e5b6"
}
```

Two of the translations are isomorphisms, not heuristics:

**Auto-layout is flex with gap.** `layoutMode` + `itemSpacing` +
`primaryAxisAlignItems` map one to one onto `flex-col gap-6 justify-*`. Valuable
side effect: gridwright **cannot** generate margins between siblings, because
Figma never gives it that information.

**Variants are props.** A component with `Size=Large, State=Hover` hands over
the matrix without anything being invented.

And an uncomfortable corollary: if the Figma does not use auto-layout, there is
no layout to extract. A better prompt will not fix that. `distill` detects it
and halts.

```console
✗ The IR is not usable.

  7 nodes are absolutely positioned (the tolerated maximum is 5).
  This frame does not use auto-layout, so there is no layout to infer.
  A better prompt will not fix this: it gets fixed in Figma.
```

---

## Verification

Figma's text engine and Chromium's differ in kerning and antialiasing: a
**perfect** component comes out 3–8% different at the pixel level. A raw diff
threshold at 1% is never reached, and at 10% anything passes. Hence a composite
score:

| Dimension | Weight | How it is measured | Noise |
|---|---|---|---|
| Structural | 50% | bounding boxes, ±2px tolerance | none |
| Chromatic | 25% | colour sampling, ΔE | none |
| Perceptual | 25% | pixel diff with a mask over text | high |

Threshold **90%**, over the **worst viewport, not the average**: if it breaks on
mobile, it is broken. When it falls short, refine is not "try again" — it
receives what failed and where, which is what makes it converge in two
iterations instead of burning tokens up to the cap.

---

## The stages

| # | Stage | Who | Gate |
|---|---|---|---|
| — | `auth` | the person | precondition, once per machine |
| 0 | `init` | human | once per project |
| 1 | `fetch` | code | |
| 2 | `distill` | code | halts if the IR comes out poor |
| 3 | `resolve` | code | |
| 4 | **`tokens`** | code + model | **human** · mandatory |
| 5 | **`library:ensure`** | code | **human, first time** · mandatory |
| 6 | `survey` | code | |
| 7 | `plan` | model | **human** |
| 8 | `author` | model | |
| 9 | `harness` | code | |
| 10 | `verify` | code | score ≥ 90 |
| 11 | `refine` | model | cap of 4 iterations |
| 12 | `golden` | human | **human** |
| 13 | **`library:register`** | code | mandatory |
| 14 | `report` | code | |

Three human gates: `plan`, `tokens` and `golden`. Nothing that mutates the
project is written without approval. A badly generated component is rewritten in
ten minutes; a contaminated token system is inherited forever.

And note the ordering of 4 and 8: **tokens are written before the component.**
The other way round, the model writes `bg-[#1a1a1a]` and someone has to
refactor.

---

## Roadmap

| Phase | What | Status |
|---|---|---|
| 0 | The spec | ✅ [`specs/001-pipeline.md`](specs/001-pipeline.md) |
| 1 | CLI, state machine, `fetch`, `distill` | ✅ |
| 2 | `verify` with Playwright, on a hand-written component | ⬜ |
| 3 | Claude Code plugin, `author`, `refine` | ⬜ |
| 4 | `tokens`, `library`, `golden`, dashboard | ⬜ |
| 5 | View mode: `survey` and composition | ⬜ |

**Phase 2 comes before phase 3 on purpose.** If you cannot measure, you cannot
close the loop: a generative pipeline without a calibrated metric is a text
generator with extra steps. The ruler first, then the factory.

---

## Development

```bash
pnpm install
pnpm test        # 52 tests
pnpm typecheck
pnpm build
```

```
packages/
├── core/     IR types, state machine, config, credentials
├── figma/    API client, distill, asset extraction
└── cli/      the `gw` binary
```

The `distill` tests run against fixtures shaped like real Figma API responses,
including a frame without auto-layout that **must** make the pipeline halt.

## Non-goals

- It does not generate design. It translates the design that exists.
- It does not fix a badly built Figma. It detects and reports it.
- No data fetching, routing or business logic.
- It does not chase pixel-perfect.
- It does not publish, commit or push anything on its own.

## License

MIT
