import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getThinkMcpDataDir,
  getThinkMcpDataFile,
  migrateLegacyFile,
} from '../storage-paths.js';

const ENV_KEY = 'THINK_MCP_DATA_DIR';

afterEach(() => {
  delete process.env[ENV_KEY];
  vi.restoreAllMocks();
});

describe('storage-paths utils', () => {
  it('uses env override for data directory and file path', () => {
    process.env[ENV_KEY] = '/tmp/think-mcp-custom';
    expect(getThinkMcpDataDir()).toBe('/tmp/think-mcp-custom');
    expect(getThinkMcpDataFile('session.json')).toBe(join('/tmp/think-mcp-custom', 'session.json'));
  });

  it('migrates legacy file to new location', async () => {
    const base = await fs.mkdtemp(join(tmpdir(), 'think-mcp-storage-test-'));
    const legacyDir = join(base, 'legacy');
    const newDir = join(base, 'new');
    const legacyFile = join(legacyDir, 'old.json');
    const newFile = join(newDir, 'new.json');

    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(legacyFile, '{"ok":true}', 'utf8');

    const migrated = await migrateLegacyFile(legacyFile, newFile);
    expect(migrated).toBe(true);

    const migratedContent = await fs.readFile(newFile, 'utf8');
    expect(migratedContent).toBe('{"ok":true}');

    await expect(fs.access(legacyFile)).rejects.toBeTruthy();
    await fs.rm(base, { recursive: true, force: true });
  });

  it('propagates migration access failures without moving either file', async () => {
    const base = await fs.mkdtemp(join(tmpdir(), 'think-mcp-storage-test-'));
    const legacyFile = join(base, 'legacy.json');
    const newFile = join(base, 'new.json');
    await fs.writeFile(legacyFile, '{"safe":true}', 'utf8');
    const accessError = Object.assign(new Error('access denied'), { code: 'EACCES' });
    vi.spyOn(fs, 'access').mockRejectedValueOnce(accessError);

    await expect(migrateLegacyFile(legacyFile, newFile)).rejects.toMatchObject({ code: 'EACCES' });
    expect(await fs.readFile(legacyFile, 'utf8')).toBe('{"safe":true}');
    await expect(fs.access(newFile)).rejects.toMatchObject({ code: 'ENOENT' });

    await fs.rm(base, { recursive: true, force: true });
  });
});
