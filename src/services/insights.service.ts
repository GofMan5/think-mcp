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

// Constants
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const INSIGHTS_FILE = join(__dirname, '..', '..', 'insights.json');
const MAX_INSIGHTS = 100; // FIFO limit to prevent bloat
const INSIGHTS_SEARCH_THRESHOLD = 0.4;

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
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
      'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
      'into', 'through', 'during', 'before', 'after', 'above', 'below',
      'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither',
      'this', 'that', 'these', 'those', 'it', 'its', 'i', 'we', 'you', 'they',
    ]);

    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length >= 3 && !stopWords.has(word))
      .slice(0, 10); // Limit to 10 keywords per insight
  }

  /**
   * Load insights from file
   */
  async load(): Promise<void> {
    try {
      const content = await fs.readFile(INSIGHTS_FILE, 'utf-8');
      this.data = JSON.parse(content) as InsightsData;
      this.rebuildIndex();
      console.error(`📚 Loaded ${this.data.winningPaths.length} insights from ${this.data.totalSessions} sessions`);
    } catch {
      // File doesn't exist - initialize empty
      this.data = {
        winningPaths: [],
        patterns: {},
        totalSessions: 0,
        lastUpdated: new Date().toISOString(),
      };
      console.error('📚 No insights file found, starting fresh');
    }
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
   * Save insights to file (atomic write)
   */
  async save(): Promise<void> {
    if (!this.data || !this.isDirty) return;

    this.data.lastUpdated = new Date().toISOString();
    const tempFile = `${INSIGHTS_FILE}.tmp`;

    try {
      await fs.writeFile(tempFile, JSON.stringify(this.data, null, 2), 'utf-8');
      await fs.rename(tempFile, INSIGHTS_FILE);
      this.isDirty = false;
      console.error(`💾 Saved ${this.data.winningPaths.length} insights`);
    } catch (error) {
      console.error('Failed to save insights:', error);
      try { await fs.unlink(tempFile); } catch { /* ignore */ }
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
      this.data!.winningPaths.shift();
    }

    // Update pattern counts
    for (const keyword of record.keywords) {
      this.data!.patterns[keyword] = (this.data!.patterns[keyword] || 0) + 1;
    }

    this.data!.totalSessions++;
    this.isDirty = true;

    // Rebuild index and save
    this.rebuildIndex();
    await this.save();

    console.error(`📝 Saved insight: "${summary.substring(0, 50)}..." (${record.keywords.length} keywords)`);
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
