/**
 * RecallService - Fuzzy search through thought history
 * Stateful service - owns Fuse.js index
 */

import Fuse from 'fuse.js';
import type {
  ThoughtRecord,
  RecallInput,
  RecallResult,
  RecallMatch,
  ExtensionType,
} from '../types/thought.types.js';
import {
  RECALL_DEFAULT_LIMIT,
  RECALL_DEFAULT_THRESHOLD,
  RECALL_SNIPPET_CONTEXT,
} from '../constants/index.js';

/** Searchable item for Fuse.js index */
interface FuseSearchItem {
  thoughtNumber: number;
  content: string;
  type: 'thought' | 'extension' | 'alternative' | 'subStep';
  extensionType?: string;
  confidence?: number;
  sessionId?: string;
  originalThought: string;
}

export class RecallService {
  /** Fuse.js instance for fuzzy search - lazy initialized */
  private fuseIndex: Fuse<FuseSearchItem> | null = null;
  /** Flag to track if index needs rebuild */
  private fuseIndexDirty = true;

  /**
   * Mark Fuse index as dirty (needs rebuild)
   * Call after adding new thoughts
   */
  invalidateIndex(): void {
    this.fuseIndexDirty = true;
  }

  /**
   * Build searchable items array for Fuse.js index
   * Extracts thoughts, extensions, alternatives, and subSteps
   */
  private buildSearchItems(thoughts: ThoughtRecord[]): FuseSearchItem[] {
    const items: FuseSearchItem[] = [];

    for (const t of thoughts) {
      // Add main thought
      items.push({
        thoughtNumber: t.thoughtNumber,
        content: t.thought,
        type: 'thought',
        confidence: t.confidence,
        sessionId: t.sessionId,
        originalThought: t.thought,
      });

      // Add extensions
      if (t.extensions) {
        for (const ext of t.extensions) {
          items.push({
            thoughtNumber: t.thoughtNumber,
            content: ext.content,
            type: 'extension',
            extensionType: ext.type,
            confidence: t.confidence,
            sessionId: t.sessionId,
            originalThought: t.thought,
          });
        }
      }

      // Add alternatives
      if (t.alternatives) {
        for (const alt of t.alternatives) {
          items.push({
            thoughtNumber: t.thoughtNumber,
            content: alt,
            type: 'alternative',
            confidence: t.confidence,
            sessionId: t.sessionId,
            originalThought: t.thought,
          });
        }
      }

      // Add subSteps
      if (t.subSteps) {
        for (const step of t.subSteps) {
          items.push({
            thoughtNumber: t.thoughtNumber,
            content: step,
            type: 'subStep',
            confidence: t.confidence,
            sessionId: t.sessionId,
            originalThought: t.thought,
          });
        }
      }
    }

    return items;
  }

  /**
   * Initialize or rebuild Fuse.js index
   * Called lazily on first search or when index is dirty
   */
  private rebuildFuseIndex(thoughts: ThoughtRecord[]): void {
    const items = this.buildSearchItems(thoughts);

    this.fuseIndex = new Fuse(items, {
      keys: ['content'],
      threshold: RECALL_DEFAULT_THRESHOLD,
      includeScore: true,
      includeMatches: true,
      minMatchCharLength: 2,
      ignoreLocation: true, // Search entire content, not just beginning
    });

    this.fuseIndexDirty = false;
    console.error(
      `🔍 Fuse index rebuilt: ${items.length} searchable items from ${thoughts.length} thoughts`
    );
  }

  /**
   * Extract snippet with context around the match
   * Returns ~200 chars centered on the match
   */
  private extractSnippet(text: string, query: string): string {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase().split(/\s+/)[0]; // Use first word for matching
    const idx = lowerText.indexOf(lowerQuery);

    if (idx === -1) {
      // Fuzzy match - return beginning of text
      return text.length > 200 ? text.substring(0, 200) + '...' : text;
    }

    // Extract context window around match
    const start = Math.max(0, idx - RECALL_SNIPPET_CONTEXT);
    const end = Math.min(text.length, idx + lowerQuery.length + RECALL_SNIPPET_CONTEXT);

    const prefix = start > 0 ? '...' : '';
    const suffix = end < text.length ? '...' : '';

    // Find word boundaries for cleaner snippets
    let snippetStart = start;
    let snippetEnd = end;

    if (start > 0) {
      const spaceIdx = text.indexOf(' ', start);
      if (spaceIdx !== -1 && spaceIdx < idx) {
        snippetStart = spaceIdx + 1;
      }
    }

    if (end < text.length) {
      const spaceIdx = text.lastIndexOf(' ', end);
      if (spaceIdx !== -1 && spaceIdx > idx) {
        snippetEnd = spaceIdx;
      }
    }

    return prefix + text.substring(snippetStart, snippetEnd).trim() + suffix;
  }

  /**
   * RECALL THOUGHT - Fuzzy search through thought history
   * Helps model "remember" details from earlier in the session
   * @param input - Search parameters
   * @param thoughts - Thoughts to search through
   */
  recallThought(input: RecallInput, thoughts: ThoughtRecord[]): RecallResult {
    const {
      query,
      scope = 'current',
      searchIn = 'all',
      limit = RECALL_DEFAULT_LIMIT,
      threshold = RECALL_DEFAULT_THRESHOLD,
    } = input;

    // Validate query
    if (!query || query.trim().length < 2) {
      return {
        matches: [],
        totalSearched: 0,
        query,
        searchParams: { scope, searchIn, threshold },
      };
    }

    // Rebuild index if dirty
    if (this.fuseIndexDirty || !this.fuseIndex) {
      this.rebuildFuseIndex(thoughts);
    }

    // Perform search (get more results than needed for filtering)
    const rawResults = this.fuseIndex?.search(query, { limit: limit * 5 }) ?? [];

    // Filter by threshold (Fuse returns score where lower = better match)
    const thresholdFiltered = rawResults.filter((r) => (r.score ?? 1) <= threshold);

    // Filter by searchIn parameter
    const filteredResults = thresholdFiltered.filter((r) => {
      if (searchIn === 'all') return true;
      if (searchIn === 'thoughts') return r.item.type === 'thought';
      if (searchIn === 'extensions') return r.item.type === 'extension';
      if (searchIn === 'alternatives')
        return r.item.type === 'alternative' || r.item.type === 'subStep';
      return true;
    });

    // Map to RecallMatch format
    const matches: RecallMatch[] = filteredResults.slice(0, limit).map((r) => ({
      thoughtNumber: r.item.thoughtNumber,
      snippet: this.extractSnippet(r.item.content, query),
      thought:
        r.item.originalThought.length > 300
          ? r.item.originalThought.substring(0, 300) + '...'
          : r.item.originalThought,
      confidence: r.item.confidence,
      relevance: r.score ?? 1,
      matchedIn: r.item.type,
      extensionType: r.item.extensionType as ExtensionType | undefined,
      sessionId: r.item.sessionId,
    }));

    // Log search
    console.error(
      `🔍 Recall search: "${query}" → ${matches.length} matches (searched ${filteredResults.length} items)`
    );

    return {
      matches,
      totalSearched: rawResults.length,
      query,
      searchParams: { scope, searchIn, threshold },
    };
  }
}
