import { promises as fs } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

const DATA_DIR_ENV = 'THINK_MCP_DATA_DIR';
const DEFAULT_DATA_DIR = join(homedir(), '.think-mcp');

/**
 * Resolve runtime data directory for think-mcp persistence.
 * Can be overridden by THINK_MCP_DATA_DIR.
 */
export function getThinkMcpDataDir(): string {
  const custom = process.env[DATA_DIR_ENV]?.trim();
  return custom && custom.length > 0 ? custom : DEFAULT_DATA_DIR;
}

/**
 * Build absolute path to a runtime data file.
 */
export function getThinkMcpDataFile(fileName: string): string {
  return join(getThinkMcpDataDir(), fileName);
}

/**
 * Ensure runtime data directory exists.
 */
export async function ensureThinkMcpDataDir(): Promise<void> {
  await fs.mkdir(getThinkMcpDataDir(), { recursive: true });
}

/**
 * Migrate a legacy file into the runtime data directory.
 * Returns true when migration happened.
 */
export async function migrateLegacyFile(legacyPath: string, newPath: string): Promise<boolean> {
  if (legacyPath === newPath) return false;

  try {
    await fs.access(newPath);
    return false; // Already migrated.
  } catch {
    // Continue.
  }

  try {
    await fs.access(legacyPath);
  } catch {
    return false; // No legacy file to migrate.
  }

  await fs.mkdir(dirname(newPath), { recursive: true });
  try {
    await fs.rename(legacyPath, newPath);
  } catch {
    const content = await fs.readFile(legacyPath);
    await fs.writeFile(newPath, content);
    try {
      await fs.unlink(legacyPath);
    } catch {
      // Ignore cleanup failures.
    }
  }

  return true;
}
