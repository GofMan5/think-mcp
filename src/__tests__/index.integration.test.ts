import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';

function textContent(result: unknown): string {
  if (!result || typeof result !== 'object' || !('content' in result) || !Array.isArray(result.content)) {
    throw new Error('Expected a direct tool result');
  }
  const content = result.content.find((item) => item?.type === 'text' && typeof item.text === 'string');
  if (!content) throw new Error('Expected text content');
  return content.text;
}

describe.sequential('MCP server model-facing contracts', () => {
  let client: Client;
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'think-mcp-server-'));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        resolve('node_modules/tsx/dist/cli.mjs'),
        resolve('src/index.ts'),
      ],
      cwd: process.cwd(),
      env: {
        ...getDefaultEnvironment(),
        THINK_MCP_DATA_DIR: tempDir,
      },
      stderr: 'pipe',
    });

    client = new Client({ name: 'think-mcp-integration-test', version: '1.0.0' });
    await client.connect(transport);
  });

  afterEach(async () => {
    await client.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('surfaces completion blockers and follows nextThoughtNeeded for routing', async () => {
    const ongoing = await client.callTool({
      name: 'think',
      arguments: {
        thought: 'Map the requested behavior and retain one explicit verification step for completion.',
        thoughtNumber: 1,
        totalThoughts: 2,
        nextThoughtNeeded: true,
        confidence: 8,
        subSteps: ['Verify the model-facing completion signal'],
        goal: 'Keep model routing aligned with actual reasoning state',
      },
    });
    const ongoingText = textContent(ongoing);

    expect(ongoingText).toContain('next:continue');
    expect(ongoingText).not.toContain('next:think_done');

    const finishing = await client.callTool({
      name: 'think',
      arguments: {
        thought: 'Confirm the response exposes every remaining check instead of hiding audit guidance.',
        thoughtNumber: 2,
        totalThoughts: 2,
        nextThoughtNeeded: false,
        confidence: 8,
      },
    });
    const finishingText = textContent(finishing);

    expect(finishingText).toContain('PRE-CONSOLIDATION AUDIT');
    expect(finishingText).toContain('Address items before think_done.');
    expect(finishingText).not.toContain('or call think_done');
    expect(finishingText).toContain('next:revise');
  });

  it('returns an actionable issue when think_done receives a disconnected path', async () => {
    const batch = await client.callTool({
      name: 'think_batch',
      arguments: {
        goal: 'Expose disconnected completion paths as actionable model guidance',
        thoughts: [
          {
            thoughtNumber: 1,
            thought: 'Establish the request boundary and the observable acceptance evidence for the first dependency.',
          },
          {
            thoughtNumber: 2,
            thought: 'Trace the intermediate state transition and its rollback behavior after a persistence failure.',
          },
          {
            thoughtNumber: 3,
            thought: 'Define final verification commands, expected outputs, and recovery checks for the completed change.',
          },
        ],
      },
    });

    expect(batch.isError).not.toBe(true);
    const batchText = textContent(batch);
    expect(batchText).toContain('next:think_done');
    expect(batchText).not.toContain('conf:');
    expect(batchText).not.toContain('Low avg confidence');

    const done = await client.callTool({
      name: 'think_done',
      arguments: {
        winningPath: [1, 3],
        summary: 'This candidate path incorrectly skips its required intermediate dependency.',
        verdict: 'ready',
      },
    });
    const doneText = textContent(done);

    expect(doneText).toContain('issue: ERROR PATH DISCONTINUITY');
    expect(doneText).toMatch(/next:\s*think/);
  });

  it('advertises distinct tool routing and truthful read-only annotations', async () => {
    const listedTools = (await client.listTools()).tools;
    expect(JSON.stringify(listedTools).length).toBeLessThanOrEqual(11_000);
    const tools = new Map(listedTools.map((tool) => [tool.name, tool]));
    const think = tools.get('think');
    const batch = tools.get('think_batch');
    const cycle = tools.get('think_cycle');
    const logic = tools.get('think_logic');

    expect(think?.description).toContain('iterative work');
    expect(batch?.description).toContain('already-complete reasoning chain');
    expect(cycle?.description).toContain('enforced multi-pass reasoning loop');
    expect(logic?.description).toContain('does not inspect code');
    expect(new Set([think?.description, batch?.description, cycle?.description, logic?.description]).size).toBe(4);
    expect(cycle?.inputSchema).toMatchObject({
      properties: { constraintCheck: { type: 'string' } },
    });

    for (const tool of tools.values()) {
      expect(tool.annotations).toMatchObject({ openWorldHint: false });
    }

    for (const name of ['think_recall', 'think_logic']) {
      expect(tools.get(name)?.annotations).toMatchObject({
        readOnlyHint: true,
        openWorldHint: false,
      });
    }

    const insightRecall = await client.callTool({
      name: 'think_recall',
      arguments: {
        query: 'prior rollback strategy',
        scope: 'insights',
        scopeId: 'session-only-id-is-ignored',
      },
    });
    expect(insightRecall.isError).not.toBe(true);
    expect(textContent(insightRecall)).not.toContain('Unknown scopeId');
  });

  it('finalizes the requested think scope without using a cycle-only active scope', async () => {
    const goal = 'Verify explicit think completion remains scope safe';
    const first = await client.callTool({
      name: 'think',
      arguments: {
        thought: 'Establish the original think scope and its completion contract.',
        thoughtNumber: 1,
        totalThoughts: 2,
        nextThoughtNeeded: true,
        confidence: 8,
        goal,
      },
    });
    const firstText = textContent(first);
    const scopeA = firstText.match(/^scope: (.+)$/m)?.[1];

    expect(scopeA).toBeTruthy();
    expect(firstText).toContain(goal);

    const second = await client.callTool({
      name: 'think',
      arguments: {
        thought: 'Verify the selected path is complete and ready for consolidation.',
        thoughtNumber: 2,
        totalThoughts: 2,
        nextThoughtNeeded: false,
        confidence: 9,
      },
    });
    expect(textContent(second)).not.toContain(goal);

    const cycle = await client.callTool({
      name: 'think_cycle',
      arguments: {
        action: 'start',
        backendMode: 'independent',
        goal: 'Run an unrelated independent cycle as the active scope',
      },
    });
    const cycleText = textContent(cycle);
    const cycleResult = JSON.parse(cycleText) as { scopeId?: string; shortTrace?: string[] };

    expect(cycleText).toBe(JSON.stringify(cycleResult));
    expect(cycleText.length).toBeLessThanOrEqual(900);
    expect(cycleResult.shortTrace).toBeUndefined();
    expect(cycleResult.scopeId).toBeTruthy();
    expect(cycleResult.scopeId).not.toBe(scopeA);

    const completion = {
      winningPath: [1, 2],
      summary: 'The two-step path establishes and verifies the completion contract.',
      verdict: 'ready',
    } as const;
    const activeDone = await client.callTool({
      name: 'think_done',
      arguments: completion,
    });
    const activeDoneText = textContent(activeDone);

    expect(activeDone.isError).toBe(true);
    expect(activeDoneText).toContain(`scope: ${cycleResult.scopeId}`);
    expect(activeDoneText).not.toContain('verdict: READY');

    const explicitNeedsMore = await client.callTool({
      name: 'think_done',
      arguments: { ...completion, verdict: 'needs_more_work', scopeId: scopeA },
    });
    const explicitNeedsMoreText = textContent(explicitNeedsMore);
    expect(explicitNeedsMoreText).toContain(`scope: ${scopeA}`);
    expect(explicitNeedsMoreText).toContain('issue: ACKNOWLEDGED:');
    expect(explicitNeedsMoreText).toContain('next: think, then retry think_done');

    const activeAfterExplicit = await client.callTool({
      name: 'think_done',
      arguments: completion,
    });
    expect(activeAfterExplicit.isError).toBe(true);
    expect(textContent(activeAfterExplicit)).toContain(`scope: ${cycleResult.scopeId}`);

    const explicitDone = await client.callTool({
      name: 'think_done',
      arguments: { ...completion, scopeId: scopeA },
    });
    const explicitDoneText = textContent(explicitDone);

    expect(explicitDone.isError).not.toBe(true);
    expect(explicitDoneText).toContain(`scope: ${scopeA}`);
    expect(explicitDoneText).toContain('verdict: READY');

    const unknownDone = await client.callTool({
      name: 'think_done',
      arguments: { ...completion, scopeId: 'missing-scope' },
    });

    expect(unknownDone.isError).toBe(true);
    expect(textContent(unknownDone)).toContain('Unknown scopeId: missing-scope');
  }, 20_000);
});
