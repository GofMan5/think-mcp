import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const ENV_KEY = 'THINK_MCP_DATA_DIR';

async function loadInsightsService() {
  vi.resetModules();
  const mod = await import('../insights.service.js');
  return mod.InsightsService;
}

describe.sequential('InsightsService', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'think-mcp-insights-test-'));
    process.env[ENV_KEY] = tempDir;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await fs.writeFile(
      join(tempDir, 'insights.json'),
      JSON.stringify({
        schemaVersion: 2,
        winningPaths: [],
        patterns: {},
        totalSessions: 0,
        lastUpdated: new Date().toISOString(),
      }),
      'utf8'
    );
  });

  afterEach(async () => {
    delete process.env[ENV_KEY];
    vi.restoreAllMocks();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('keeps pattern counts consistent when FIFO evicts old insights', async () => {
    const InsightsService = await loadInsightsService();
    const service = new InsightsService();

    for (let i = 0; i < 101; i++) {
      await service.saveWinningPath({
        path: [1, 2],
        summary: `token${i} solution summary`,
        sessionLength: 2,
      });
    }

    const stored = JSON.parse(await fs.readFile(join(tempDir, 'insights.json'), 'utf8')) as {
      winningPaths: unknown[];
      patterns: Record<string, number>;
      totalSessions: number;
    };

    expect(stored.winningPaths).toHaveLength(100);
    expect(stored.patterns.token0).toBeUndefined();
    expect(stored.patterns.token100).toBe(1);
    expect(stored.totalSessions).toBe(101);
  });

  it('normalizes corrupted persisted data and rebuilds patterns from winning paths', async () => {
    const filePath = join(tempDir, 'insights.json');
    await fs.writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
        winningPaths: [
          {
            path: [1, 2],
            summary: 'fresh insight for recovery',
            goal: 'recover from stale persistence',
            keywords: ['fresh', 'recovery'],
            timestamp: '2025-01-01T00:00:00.000Z',
            sessionLength: 2,
          },
          {
            path: 'invalid',
            summary: 42,
            keywords: 'stale',
          },
        ],
        patterns: { stale: 99, fresh: 1 },
        totalSessions: 0,
        lastUpdated: 'invalid-date',
      }),
      'utf8'
    );

    const InsightsService = await loadInsightsService();
    const service = new InsightsService();
    await service.load();

    const stats = await service.getStats();
    expect(stats.totalInsights).toBe(1);
    expect(stats.totalSessions).toBe(1);
    expect(stats.topPatterns.some((p) => p.keyword === 'fresh')).toBe(true);
    expect(stats.topPatterns.some((p) => p.keyword === 'stale')).toBe(false);

    const search = await service.search('fresh', 3);
    expect(search.totalInsights).toBe(1);
  });
});
