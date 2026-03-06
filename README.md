<div align="center">

# Think MCP

**Structured reasoning tools for MCP-compatible LLM clients**

[![npm version](https://img.shields.io/npm/v/@gofman3/think-mcp?style=flat-square&color=cb3837)](https://www.npmjs.com/package/@gofman3/think-mcp)
[![license](https://img.shields.io/badge/license-MIT-f5c542?style=flat-square)](https://opensource.org/licenses/MIT)
[![mcp](https://img.shields.io/badge/MCP-compatible-111827?style=flat-square)](https://modelcontextprotocol.io/)
[![release gates](https://img.shields.io/badge/release-validated-1f7a5c?style=flat-square)](#quality-and-release-gates)

Reason step by step, branch when needed, block weak finals, and keep useful memory across sessions.

[Install](#install) | [Tools](#toolset) | [think_cycle](#think_cycle) | [Quality Gates](#quality-and-release-gates) | [Changelog](#changelog)

</div>

---

## Why this exists

Most LLM workflows fail in predictable ways:

- They answer too early.
- They stay linear when the task needs alternatives or critique.
- They lose earlier insights between steps.
- They finish with confidence that is not backed by verification.

Think MCP adds an external reasoning layer for those failures. It does not replace the model's intelligence. It constrains and structures the way that intelligence is used.

## What is in 5.5.1

- Fixed mojibake and broken runtime coaching text.
- Refreshed the README and aligned it with the current toolset.
- Kept the `think_cycle` hard-gate workflow introduced in `5.5.0`.
- Preserved release validation, eval coverage, and hard quality policy checks.

## Core model

Think MCP combines three layers:

| Layer | Role | Outcome |
| :--- | :--- | :--- |
| `think` / `think_batch` | Capture reasoning steps | Better decomposition, branching, revisions |
| `think_cycle` | Enforce adaptive depth and hard final gate | Blocks shallow or weak final answers |
| Recall + coaching + validation | Preserve useful context and warn on weak patterns | Better consistency and fewer dead-end sessions |

## Install

### Run directly

```bash
npx -y @gofman3/think-mcp
```

### MCP config

```json
{
  "mcpServers": {
    "think": {
      "command": "npx",
      "args": ["-y", "@gofman3/think-mcp"]
    }
  }
}
```

### Local development

```bash
npm install
npm run build
npm test
```

## Toolset

| Tool | Purpose | Best use |
| :--- | :--- | :--- |
| `think` | Add one structured reasoning step | Medium-complexity tasks that need guided progression |
| `think_batch` | Submit multiple reasoning steps at once | Fast batch decomposition or prebuilt chains |
| `think_cycle` | Adaptive reasoning state machine with hard quality gate | High-risk or high-complexity tasks |
| `think_logic` | Generate strict analysis methodology | Audits, architecture review, deep technical analysis |
| `think_recall` | Search current session or stored insights | Reuse patterns, avoid repeating dead ends |
| `think_done` | Finalize a session with validation | Controlled session completion |
| `think_reset` | Clear current session state | Hard context shift only |

## `think_cycle`

`think_cycle` is the main depth-control tool in the current release.

It runs a session as a state machine:

`start -> step -> status -> finalize`

If the reasoning quality is weak, `finalize` does not silently pass. It blocks completion and returns concrete next prompts plus a required minimum of additional thoughts.

### Key behavior

- Adaptive required depth based on goal complexity and risk markers.
- Hard gate for phase coverage: `decompose`, `alternative`, `critique`, `synthesis`, `verification`.
- Quality score with penalties for repetition, weak verification, and unstable confidence.
- Fallback interop with the regular `think` backend when `backendMode=auto`.
- Loop budget control to avoid infinite cost and latency growth.

### Input shape

```ts
{
  action: 'start' | 'step' | 'status' | 'finalize' | 'reset',
  sessionId?: string,
  goal?: string,
  context?: string,
  constraints?: string[],
  thought?: string,
  thoughtType?: 'decompose' | 'alternative' | 'critique' | 'synthesis' | 'verification' | 'revision',
  confidence?: number,
  finalAnswer?: string,
  backendMode?: 'auto' | 'independent' | 'think',
  maxLoops?: number,
  showTrace?: boolean
}
```

### Output shape

```ts
{
  status: 'in_progress' | 'blocked' | 'ready' | 'completed' | 'error',
  sessionId: string,
  loop: { current: number, max: number, required: number, remaining: number },
  quality: {
    overall: number,
    coverage: number,
    critique: number,
    verification: number,
    diversity: number,
    confidenceStability: number
  },
  gate: { passed: boolean, reasonCodes: string[] },
  requiredMoreThoughts: number,
  nextPrompts: string[],
  shortTrace: string[],
  finalApprovedAnswer?: string
}
```

### Example flow

```ts
// 1. Start
{
  action: 'start',
  goal: 'Design a safe migration from Redis session cache to Postgres-backed sessions',
  constraints: ['zero logout spike', 'rollback in under 5 minutes'],
  backendMode: 'auto'
}

// 2. Add steps
{
  action: 'step',
  sessionId: 'cycle_xxx',
  thought: 'Break the migration into dual-write, read-fallback, rollout metrics, and rollback paths.'
}

// 3. Try to finalize
{
  action: 'finalize',
  sessionId: 'cycle_xxx',
  finalAnswer: 'We should migrate in phases and monitor it carefully...'
}
```

Typical blocked response:

```ts
{
  status: 'blocked',
  gate: { passed: false, reasonCodes: ['MISSING_VERIFICATION', 'LOW_DIVERSITY'] },
  requiredMoreThoughts: 10,
  nextPrompts: [
    'List concrete rollback failure modes.',
    'Verify whether session consistency breaks during dual-write.',
    'Compare at least two rollout strategies.'
  ]
}
```

## Other tools

### `think`

Use when you want incremental reasoning with revisions, branches, substeps, and quick extensions.

```ts
{
  thought: 'The bug likely comes from stale branch state after retry.',
  thoughtNumber: 3,
  totalThoughts: 7,
  nextThoughtNeeded: true,
  confidence: 6,
  quickExtension: {
    type: 'critique',
    content: 'Verify whether retry state is recreated or reused.'
  }
}
```

### `think_batch`

Use when you already know the rough chain and want to submit it in one call.

```ts
{
  goal: 'Audit deployment rollback flow',
  thoughts: [
    { thoughtNumber: 1, thought: 'Identify entry points for rollout state changes.' },
    { thoughtNumber: 2, thought: 'Trace rollback triggers and timeout behavior.' }
  ]
}
```

### `think_logic`

Use for strict methodology generation before a deep audit.

```ts
{
  target: 'Review the payment retry pipeline for consistency and failure isolation',
  depth: 'deep',
  focus: ['reliability', 'performance', 'data-flow']
}
```

### `think_recall`

Use before starting a familiar class of problem.

```ts
{
  query: 'rollback strategy cache migration',
  scope: 'insights',
  searchIn: 'all',
  limit: 5
}
```

## Quality and release gates

Release verification is built into the repo:

```bash
npm run validate:release
```

Main checks:

- TypeScript typecheck
- Unit tests
- Local eval scenarios
- Repo structure validation
- Security audit
- Hard quality baseline in `docs/quality/HARD_QUALITY_STANDARD.md`

## Runtime storage

- Default data directory: `~/.think-mcp`
- Override with `THINK_MCP_DATA_DIR`
- `think_cycle` sessions persist in runtime storage with TTL cleanup

## Package links

- npm: [@gofman3/think-mcp](https://www.npmjs.com/package/@gofman3/think-mcp)
- repo: [GofMan5/think-mcp](https://github.com/GofMan5/think-mcp)

## Changelog

### v5.5.1

- Fixed broken mojibake output in runtime coaching strings.
- Rebuilt and refreshed README for the current toolset and quality model.
- Released documentation and packaging cleanup on top of `5.5.0`.

### v5.5.0

- Added `think_cycle` for adaptive external reasoning with hard quality gates.
- Added release-gated hard quality policy based on `NEED_ADD`.
- Added eval scenarios for cycle gating, fallback behavior, autonomy quality, safety gates, and bounded retries.

### v5.1.0

- Switched prompt style toward imperative IF/THEN instructions.
- Reduced token overhead significantly for common reasoning flows.

### v5.0.0

- Added `think_logic` methodology generation.

---

<div align="center">
Built for controlled reasoning, not blind verbosity.
</div>
