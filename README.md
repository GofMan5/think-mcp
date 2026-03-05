<div align="center">

# 🧠 Think MCP

**Structured Sequential Thinking Server for LLMs**

[![npm version](https://img.shields.io/npm/v/@gofman3/think-mcp?style=flat-square&color=cb3837)](https://www.npmjs.com/package/@gofman3/think-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-blueviolet?style=flat-square)](https://modelcontextprotocol.io/)

<p align="center">
  <b>Break down complex problems. Branch out ideas. Remember insights.</b><br>
  Designed for LLMs to think deeper, smarter, and more efficiently.
</p>

[Quick Start](#-quick-start) • [Tools](#-tools-reference) • [Features](#-features) • [Changelog](#-changelog)

</div>

---

## 📖 Overview

**Think MCP** transforms how LLMs approach problem-solving. It's not just a tool; it's a cognitive framework that enables:
- **Sequential Reasoning**: Step-by-step problem decomposition.
- **Branching & Revision**: Ability to backtrack, fork thoughts, and correct mistakes.
- **Deep Analysis**: Built-in methodology generator for rigorous code and logic auditing.
- **Long-term Memory**: Cross-session recall of insights and dead ends.

---

## ✨ Features

| Feature | Description |
| :--- | :--- |
| **🚀 Efficient Thinking** | **Imperative Prompts (v5.1)** reduce token usage by ~55% using IF/THEN logic. |
| **⚡️ Burst Mode** | Submit up to **30 thoughts** in a single API call with `think_batch`. |
| **🧠 Methodology Generator** | On-demand deep analysis frameworks (Chain Mapping, Crack Hunting, etc.) via `think_logic`. |
| **💾 Smart Memory** | Cross-session learning via `think_recall` and auto-save with 24h retention. |
| **🔔 Nudge System** | Proactive micro-prompts to detect low confidence, tunnel vision, or missed steps. |
| **🌳 Branching** | Explore alternative paths without losing context. |

---

## 🚀 Quick Start

### Installation

```bash
npx @gofman3/think-mcp
```

### MCP Configuration

Add this to your MCP settings file:

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

---

## 🛠️ Tools Reference

### 1. `think`
*The core unit of reasoning.* Adds a single thought to the chain.

> **⚠️ Sequence Safety**
> - `IF thoughtNumber skips expected step` → Reject (`ERR_SEQUENCE`)
> - `IF invalid revision/branch target` → Reject with stable error code

```typescript
{
  thought: string,             // The reasoning content
  thoughtNumber: number,       // Current step index
  totalThoughts: number,       // Estimated total steps
  nextThoughtNeeded: boolean,  // Is the chain complete?
  confidence?: number,         // Score 1-10
  goal?: string,               // Required for the first thought
  subSteps?: string[],         // Breakdown of current step (max 5)
  alternatives?: string[],     // Other approaches considered (max 5)
  quickExtension?: {           // Immediate micro-actions
    type: 'critique' | 'elaboration' | 'correction' | 'innovation' | 'polish',
    content: string,
    impact?: 'low' | 'medium' | 'high' | 'blocker'
  },
  isRevision?: boolean,        // Is this correcting a previous step?
  revisesThought?: number,     // Which step is being fixed?
  branchId?: string            // For branching paths
}
```

### 2. `think_batch`
*High-velocity reasoning.* Submit a complete chain (1-30 thoughts) at once.

> **⚠️ Constraints**
> - `IF similarity > 60%` → Reject ("Stagnation")
> - `IF thought < 50 chars` → Reject ("Too short")
> - `IF avg_confidence < 4` → Warning issued

```typescript
{
  goal: string,               // Min 10 chars
  thoughts: Array<{           // List of thought objects
    thoughtNumber: number,
    thought: string,          // 50-1000 chars
    confidence?: number,
    // ... other standard fields
  }>,
  consolidation?: {
    winningPath: number[],
    summary: string,
    verdict: 'ready' | 'needs_more_work'
  }
}
```

### 3. `think_logic`
*The Architect.* Generates a strict thinking methodology for complex analysis.

**Output Phases:** `CHAIN MAPPING` → `CRACK HUNTING` → `STANDARD BENCHMARK` → `ACTION PLANNING`

```typescript
{
  target: string,              // The subject of analysis (Min 10 chars)
  depth?: 'quick' | 'standard' | 'deep',
  focus?: ('security' | 'performance' | 'reliability' | 'ux' | 'data-flow')[],
  stack?: ('nestjs' | 'react' | 'redis' | 'nextjs' | /* etc */)[]
}
```

### 4. `think_recall`
*The Memory Bank.* Search current session or past insights.

**Best Practices:**
- `BEFORE complex_task` → Check `scope: 'insights'`
- `IF repeating_logic` → Check for dead ends
- `IF unsure` → Verify context

```typescript
{
  query: string,
  scope?: 'session' | 'insights',
  searchIn?: 'thoughts' | 'extensions' | 'alternatives' | 'all',
  limit?: number
}
```

### 5. `think_done` & `think_reset`
- **`think_done`**: Finalize session. Validates gaps, blockers, and confidence levels.
- **`think_reset`**: Wipe the slate clean. *(Use only if task context changes completely).*

---

## ✅ Quality Gates

Before release:

```bash
npm run validate:release
```

Local hardening eval report:

```bash
npm run eval:local
```

### Runtime Storage

- Session and insights data are stored in user data directory (`~/.think-mcp` by default).
- Override path via environment variable: `THINK_MCP_DATA_DIR`.

---

## 💡 Intelligent Systems

### The Nudge System
*The server watches your back.*

| Trigger Pattern | System Nudge |
| :--- | :--- |
| `confidence < 5` | "Low confidence. Validate?" |
| `3+ thoughts` w/o alternatives | "No alternatives. Tunnel vision?" |
| Complex goal w/o subSteps | "Complex goal, no breakdown. Decompose?" |
| Unresolved blocker | "Blocker unresolved. Fix first." |

### Complexity Budget
*Recommended tool usage based on task size.*

| Task Difficulty | Thoughts | Recommended Tool |
| :--- | :--- | :--- |
| **Simple** | 0-2 | *Skip (Direct Answer)* |
| **Medium** | 3-7 | `think` (Step-by-step) |
| **Complex** | 8-30 | `think_batch` (Burst mode) |

---

## 🔄 Changelog

<details open>
<summary><b>v5.1.0 (Current)</b></summary>

- **Imperative Prompts**: Switched to IF/THEN style instructions.
- **Performance**: ~55% Token Reduction per request.
- **Optimization**: Faster parsing, less LLM overhead.
</details>

<details>
<summary><b>v5.0.0</b></summary>

- **New Tool**: `think_logic` for generating methodologies.
- **Framework**: Added 4-phase analysis (Mapping, Cracking, Benchmarking, Planning).
</details>

<details>
<summary><b>v4.x.x History</b></summary>

- **v4.6.0**: Added NudgeService for proactive prompts.
- **v4.5.0**: Renamed to `think`, added Cross-session insights.
- **v4.1.0**: Introduced Burst Thinking (`think_batch`).
</details>

---

<div align="center">
  <sub>MIT License • Created by @gofman3</sub>
</div>
