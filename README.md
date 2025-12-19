# 🧠 Think MCP

MCP Server for structured sequential thinking. Helps LLMs break down complex problems into manageable steps with branching, revisions, and self-critique.

## Features

- **Sequential Thinking** — Step-by-step reasoning with confidence tracking
- **Branching & Revisions** — Explore alternatives, fix mistakes
- **Dead Ends Tracking** — Remember rejected paths to avoid circular thinking
- **Proactive Coach** — Nudges for better thinking (low confidence, missing critique)
- **Fuzzy Recall** — Search through thought history with Fuse.js

## Quick Start

### Using npx (recommended)

```bash
npx @gofman5/think-mcp
```

### Install globally

```bash
npm install -g @gofman5/think-mcp
think-mcp
```

## MCP Configuration

Add to your MCP config (`mcp.json`):

```json
{
  "mcpServers": {
    "think": {
      "command": "npx",
      "args": ["@gofman5/think-mcp"]
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "think": {
      "command": "think-mcp"
    }
  }
}
```

## Tools

### `sequentialthinking`
Primary tool for step-by-step reasoning.

```typescript
{
  thought: string,        // Your current reasoning step
  thoughtNumber: number,  // Sequential: 1, 2, 3...
  totalThoughts: number,  // Estimate (auto-adjusts)
  confidence?: number,    // 1-10
  nextThoughtNeeded: boolean,
  isRevision?: boolean,
  revisesThought?: number,
  branchFromThought?: number,
  branchId?: string,
  subSteps?: string[],    // Micro-plan (max 5)
  alternatives?: string[] // Quick comparison (max 5)
}
```

### `extend_thought`
Deep-dive into a specific thought without advancing.

```typescript
{
  targetThoughtNumber: number,
  extensionType: 'critique' | 'elaboration' | 'optimization' | 'polish' | ...,
  content: string,
  impactOnFinalResult: 'low' | 'medium' | 'high' | 'blocker'
}
```

### `consolidate_and_verify`
Final validation before answering.

```typescript
{
  winningPath: number[],  // e.g., [1, 2, 5, 8]
  summary: string,
  verdict: 'ready' | 'needs_more_work'
}
```

### `recall_thought`
Fuzzy search through thought history.

```typescript
{
  query: string,
  scope?: 'current' | 'all',
  searchIn?: 'thoughts' | 'extensions' | 'alternatives' | 'all',
  limit?: number,
  threshold?: number  // 0-1, lower = stricter
}
```

### `reset_session`
Clear all thoughts and start fresh.

### `export_session`
Export session as Markdown or JSON.

## License

MIT
