/**
 * InsightsService - Cross-session learning from winning paths
 * Version 1.0.0
 *
 * Stores successful reasoning patterns for future recall.
 * NO LLM, NO Vector DB - just JSON persistence + Fuse.js search.
 */

import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import Fuse from 'fuse.js';
import {
  ensureThinkMcpDataDir,
  getThinkMcpDataFile,
  migrateLegacyFile,
} from '../utils/storage-paths.js';

// Constants
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LEGACY_INSIGHTS_FILE = join(__dirname, '..', '..', 'insights.json');
const INSIGHTS_FILE = getThinkMcpDataFile('insights.json');
const INSIGHTS_SCHEMA_VERSION = 2;
const MAX_INSIGHTS = 100; // FIFO limit to prevent bloat
const INSIGHTS_SEARCH_THRESHOLD = 0.4;
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither',
  'this', 'that', 'these', 'those', 'it', 'its', 'i', 'we', 'you', 'they',
]);

/** Single winning path record */
export interface WinningPathRecord {
  /** Thought numbers in the winning path */
  path: number[];
  /** Summary of the solution */
  summary: string;
  /** Session goal that was achieved */
  goal?: string;
  /** Keywords extracted from summary/goal */
  keywords: string[];
  /** When this insight was recorded */
  timestamp: string;
  /** Average confidence of the session */
  avgConfidence?: number;
  /** Number of thoughts in the session */
  sessionLength: number;
}

/** Insights storage structure */
export interface InsightsData {
  /** Storage schema version */
  schemaVersion: number;
  /** Stored winning paths */
  winningPaths: WinningPathRecord[];
  /** Keyword frequency for pattern detection */
  patterns: Record<string, number>;
  /** Total sessions recorded */
  totalSessions: number;
  /** Last update timestamp */
  lastUpdated: string;
}

/** Input for saving a winning path */
export interface SaveInsightInput {
  path: number[];
  summary: string;
  goal?: string;
  avgConfidence?: number;
  sessionLength: number;
}

/** Single match from insights search */
export interface InsightMatch {
  /** The winning path record */
  insight: WinningPathRecord;
  /** Relevance score (0-1, lower = better) */
  relevance: number;
}

/** Result from insights search */
export interface InsightsSearchResult {
  matches: InsightMatch[];
  totalInsights: number;
  topPatterns: { keyword: string; count: number }[];
}

export class InsightsService {
  private data: InsightsData | null = null;
  private fuseIndex: Fuse<WinningPathRecord> | null = null;
  private isDirty = false;

  /**
   * Extract keywords from text for pattern tracking
   */
  private extractKeywords(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length >= 3 && !STOP_WORDS.has(word))
      .slice(0, 10); // Limit to 10 keywords per insight
  }

  /**
   * Normalize one persisted winning path record.
   */
  private normalizeWinningPath(raw: unknown): WinningPathRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as Partial<WinningPathRecord>;
    if (typeof candidate.summary !== 'string' || candidate.summary.trim().length === 0) {
      return null;
    }

    const path = Array.isArray(candidate.path)
      ? candidate.path.filter((n): n is number => Number.isInteger(n) && n > 0)
      : [];
    if (path.length === 0) return null;

    const keywords = Array.isArray(candidate.keywords)
      ? [...new Set(candidate.keywords
        .filter((kw): kw is string => typeof kw === 'string' && kw.trim().length > 0)
        .map((kw) => kw.toLowerCase()))]
      : [];

    const goal = typeof candidate.goal === 'string' && candidate.goal.trim().length > 0
      ? candidate.goal
      : undefined;

    const timestamp = typeof candidate.timestamp === 'string' && !Number.isNaN(Date.parse(candidate.timestamp))
      ? candidate.timestamp
      : new Date(0).toISOString();

    const avgConfidence =
      typeof candidate.avgConfidence === 'number' && Number.isFinite(candidate.avgConfidence)
        ? candidate.avgConfidence
        : undefined;

    const sessionLength =
      typeof candidate.sessionLength === 'number' &&
      Number.isFinite(candidate.sessionLength) &&
      candidate.sessionLength > 0
        ? Math.floor(candidate.sessionLength)
        : path.length;

    return {
      path,
      summary: candidate.summary.trim(),
      goal,
      keywords,
      timestamp,
      avgConfidence,
      sessionLength,
    };
  }

  /**
   * Build keyword frequency map from current winning paths.
   */
  private buildPatternCounts(paths: WinningPathRecord[]): Record<string, number> {
    const patterns: Record<string, number> = {};
    for (const record of paths) {
      for (const keyword of record.keywords) {
        patterns[keyword] = (patterns[keyword] || 0) + 1;
      }
    }
    return patterns;
  }

  /**
   * Normalize persisted insights payload.
   */
  private normalizeLoadedData(raw: unknown): InsightsData {
    const parsed = raw && typeof raw === 'object' ? (raw as Partial<InsightsData>) : {};

    const winningPaths = Array.isArray(parsed.winningPaths)
      ? parsed.winningPaths
        .map((record) => this.normalizeWinningPath(record))
        .filter((record): record is WinningPathRecord => record !== null)
      : [];

    const totalSessionsRaw =
      typeof parsed.totalSessions === 'number' &&
      Number.isFinite(parsed.totalSessions) &&
      parsed.totalSessions >= 0
        ? Math.floor(parsed.totalSessions)
        : winningPaths.length;

    return {
      schemaVersion: INSIGHTS_SCHEMA_VERSION,
      winningPaths,
      patterns: this.buildPatternCounts(winningPaths),
      totalSessions: Math.max(totalSessionsRaw, winningPaths.length),
      lastUpdated:
        typeof parsed.lastUpdated === 'string' && !Number.isNaN(Date.parse(parsed.lastUpdated))
          ? parsed.lastUpdated
          : new Date().toISOString(),
    };
  }

  /**
   * Rebuild Fuse.js index for search
   */
  private rebuildIndex(): void {
    if (!this.data) return;

    this.fuseIndex = new Fuse(this.data.winningPaths, {
      keys: [
        { name: 'summary', weight: 0.5 },
        { name: 'goal', weight: 0.3 },
        { name: 'keywords', weight: 0.2 },
      ],
      threshold: INSIGHTS_SEARCH_THRESHOLD,
      includeScore: true,
      ignoreLocation: true,
    });
  }

  /**
   * Load insights from file
   */
  async load(): Promise<void> {
    await this.migrateLegacyInsightsIfNeeded();
    try {
      const content = await fs.readFile(INSIGHTS_FILE, 'utf-8');
      const parsed = JSON.parse(content) as unknown;
      this.data = this.normalizeLoadedData(parsed);
      this.rebuildIndex();
      console.error(`Loaded ${this.data.winningPaths.length} insights from ${this.data.totalSessions} sessions`);
    } catch {
      // File doesn't exist or is corrupted - initialize empty
      this.data = {
        schemaVersion: INSIGHTS_SCHEMA_VERSION,
        winningPaths: [],
        patterns: {},
        totalSessions: 0,
        lastUpdated: new Date().toISOString(),
      };
      this.rebuildIndex();
      console.error('No insights file found or it is corrupted, starting fresh');
    }
  }

  /**
   * Save insights to file (atomic write)
   */
  async save(): Promise<void> {
    if (!this.data || !this.isDirty) return;

    this.data.schemaVersion = INSIGHTS_SCHEMA_VERSION;
    this.data.lastUpdated = new Date().toISOString();
    const tempFile = `${INSIGHTS_FILE}.tmp`;

    try {
      await ensureThinkMcpDataDir();
      await fs.writeFile(tempFile, JSON.stringify(this.data, null, 2), 'utf-8');
      await fs.rename(tempFile, INSIGHTS_FILE);
      this.isDirty = false;
      console.error(`Saved ${this.data.winningPaths.length} insights`);
    } catch (error) {
      console.error('Failed to save insights:', error);
      try { await fs.unlink(tempFile); } catch { /* ignore */ }
    }
  }

  /**
   * Migrate legacy root-level insights file into runtime data directory.
   */
  private async migrateLegacyInsightsIfNeeded(): Promise<void> {
    try {
      const migrated = await migrateLegacyFile(LEGACY_INSIGHTS_FILE, INSIGHTS_FILE);
      if (migrated) {
        console.error(`Migrated legacy insights file to ${INSIGHTS_FILE}`);
      }
    } catch (error) {
      console.error('Failed to migrate legacy insights file:', error);
    }
  }

  /**
   * Increment keyword counters in memory.
   */
  private incrementPatternCounts(keywords: string[]): void {
    if (!this.data) return;
    for (const keyword of keywords) {
      this.data.patterns[keyword] = (this.data.patterns[keyword] || 0) + 1;
    }
  }

  /**
   * Decrement keyword counters in memory, removing zero-count keys.
   */
  private decrementPatternCounts(keywords: string[]): void {
    if (!this.data) return;
    for (const keyword of keywords) {
      const nextCount = (this.data.patterns[keyword] || 0) - 1;
      if (nextCount > 0) {
        this.data.patterns[keyword] = nextCount;
      } else {
        delete this.data.patterns[keyword];
      }
    }
  }

  /**
   * Save a winning path as an insight
   */
  async saveWinningPath(input: SaveInsightInput): Promise<void> {
    if (!this.data) await this.load();

    const { path, summary, goal, avgConfidence, sessionLength } = input;

    // Extract keywords from summary and goal
    const keywords = [
      ...this.extractKeywords(summary),
      ...(goal ? this.extractKeywords(goal) : []),
    ];

    // Create record
    const record: WinningPathRecord = {
      path,
      summary,
      goal,
      keywords: [...new Set(keywords)], // Dedupe
      timestamp: new Date().toISOString(),
      avgConfidence,
      sessionLength,
    };

    // Add to winningPaths (FIFO)
    this.data!.winningPaths.push(record);
    if (this.data!.winningPaths.length > MAX_INSIGHTS) {
      const evicted = this.data!.winningPaths.shift();
      if (evicted) {
        this.decrementPatternCounts(evicted.keywords);
      }
    }

    // Update pattern counts
    this.incrementPatternCounts(record.keywords);

    this.data!.totalSessions++;
    this.isDirty = true;

    // Rebuild index and save
    this.rebuildIndex();
    await this.save();

    console.error(`Saved insight: "${summary.substring(0, 50)}..." (${record.keywords.length} keywords)`);
  }

  /**
   * Search insights by query
   */
  async search(query: string, limit = 3): Promise<InsightsSearchResult> {
    if (!this.data) await this.load();
    if (!this.fuseIndex || this.data!.winningPaths.length === 0) {
      return {
        matches: [],
        totalInsights: 0,
        topPatterns: [],
      };
    }

    // Search using Fuse.js
    const results = this.fuseIndex.search(query, { limit });

    const matches: InsightMatch[] = results.map(r => ({
      insight: r.item,
      relevance: r.score ?? 1,
    }));

    // Get top patterns
    const topPatterns = Object.entries(this.data!.patterns)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([keyword, count]) => ({ keyword, count }));

    return {
      matches,
      totalInsights: this.data!.winningPaths.length,
      topPatterns,
    };
  }

  /**
   * Get statistics about stored insights
   */
  async getStats(): Promise<{
    totalInsights: number;
    totalSessions: number;
    topPatterns: { keyword: string; count: number }[];
    avgSessionLength: number;
    avgConfidence: number;
  }> {
    if (!this.data) await this.load();

    const paths = this.data!.winningPaths;
    const avgSessionLength = paths.length > 0
      ? paths.reduce((sum, p) => sum + p.sessionLength, 0) / paths.length
      : 0;

    const withConfidence = paths.filter(p => p.avgConfidence !== undefined);
    const avgConfidence = withConfidence.length > 0
      ? withConfidence.reduce((sum, p) => sum + (p.avgConfidence ?? 0), 0) / withConfidence.length
      : 0;

    const topPatterns = Object.entries(this.data!.patterns)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([keyword, count]) => ({ keyword, count }));

    return {
      totalInsights: paths.length,
      totalSessions: this.data!.totalSessions,
      topPatterns,
      avgSessionLength: Math.round(avgSessionLength * 10) / 10,
      avgConfidence: Math.round(avgConfidence * 10) / 10,
    };
  }
}
