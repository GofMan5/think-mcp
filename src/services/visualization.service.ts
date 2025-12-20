/**
 * VisualizationService - ASCII tree and Mermaid diagram generation
 * Stateless service - receives data as parameters
 * v4.3.0 - Improved visualization with confidence icons and truncation
 */

import type { ThoughtRecord } from '../types/thought.types.js';
import { sanitizeForMermaid } from '../utils/index.js';

// v4.3.0: Max thoughts to show in tree (older ones collapsed)
const MAX_TREE_THOUGHTS = 5;

/**
 * Get confidence icon based on score
 */
function getConfidenceIcon(confidence?: number): string {
  if (!confidence) return '○';
  if (confidence >= 8) return '✅';
  if (confidence >= 5) return '⚠️';
  return '❌';
}

export class VisualizationService {
  /**
   * Generate ASCII tree visualization of thought structure
   * v4.3.0: Added confidence icons, truncation for long sessions
   * @param sessionThoughts - thoughts from current session
   * @param branches - Map of branch ID to branch thoughts
   */
  generateAsciiTree(
    sessionThoughts: ThoughtRecord[],
    branches: Map<string, ThoughtRecord[]>
  ): string {
    if (sessionThoughts.length === 0) return '(empty)';

    const mainThoughts = sessionThoughts.filter(
      (t) => !t.branchFromThought && !t.isRevision
    );

    // v4.3.0: Truncate long sessions
    const shouldTruncate = mainThoughts.length > MAX_TREE_THOUGHTS;
    const hiddenCount = shouldTruncate ? mainThoughts.length - MAX_TREE_THOUGHTS : 0;
    const visibleThoughts = shouldTruncate 
      ? mainThoughts.slice(-MAX_TREE_THOUGHTS) 
      : mainThoughts;

    const lines: string[] = ['📊 Thought Tree:'];
    
    // Show truncation notice
    if (shouldTruncate) {
      lines.push(`│   ... ${hiddenCount} earlier thought(s) hidden`);
    }

    for (let i = 0; i < visibleThoughts.length; i++) {
      const thought = visibleThoughts[i];
      const isLast = i === visibleThoughts.length - 1;
      const prefix = isLast ? '└──' : '├──';
      const childPrefix = isLast ? '    ' : '│   ';
      
      // v4.3.0: Confidence icon instead of [N]
      const confIcon = getConfidenceIcon(thought.confidence);
      const preview = thought.thought.substring(0, 35);
      lines.push(`${prefix} ${confIcon} #${thought.thoughtNumber}: ${preview}...`);

      // Show subSteps (compact)
      if (thought.subSteps && thought.subSteps.length > 0) {
        lines.push(`${childPrefix}📋 [${thought.subSteps.length} steps]`);
      }

      // Show alternatives (compact)
      if (thought.alternatives && thought.alternatives.length > 0) {
        lines.push(`${childPrefix}⚖️ [${thought.alternatives.length} alts]`);
      }

      // Show extensions (compact - only count)
      if (thought.extensions && thought.extensions.length > 0) {
        const blockers = thought.extensions.filter(e => e.impact === 'blocker').length;
        const extInfo = blockers > 0 ? `${thought.extensions.length} ext, ${blockers}🚫` : `${thought.extensions.length} ext`;
        lines.push(`${childPrefix}🔍 [${extInfo}]`);
      }

      // Show revisions (compact)
      const revisions = sessionThoughts.filter(
        (t) => t.isRevision && t.revisesThought === thought.thoughtNumber
      );
      if (revisions.length > 0) {
        lines.push(`${childPrefix}🔄 [${revisions.length} revision(s)]`);
      }

      // Show branches (compact)
      for (const [branchId, branchThoughts] of branches) {
        const fromThis = branchThoughts.filter(
          (t) => t.branchFromThought === thought.thoughtNumber
        );
        if (fromThis.length > 0) {
          lines.push(`${childPrefix}🌿 [${branchId}]: ${fromThis.length} thought(s)`);
        }
      }
    }

    return lines.join('\n');
  }


  /**
   * Generate Mermaid.js graph visualization
   * @param sessionThoughts - thoughts from current session
   * @param branches - Map of branch ID to branch thoughts
   * @param thoughtHistory - full thought history for branch filtering
   * @param sessionStartIndex - index where current session starts
   */
  generateMermaid(
    sessionThoughts: ThoughtRecord[],
    branches: Map<string, ThoughtRecord[]>,
    thoughtHistory: ThoughtRecord[],
    sessionStartIndex: number
  ): string {
    if (sessionThoughts.length === 0) return '';

    const lines: string[] = ['graph TD;'];
    const mainThoughts = sessionThoughts.filter(
      (t) => !t.branchFromThought && !t.isRevision
    );

    // Build set of revised thoughts (thoughts that have been superseded)
    const revisedThoughts = new Set(
      sessionThoughts
        .filter((t) => t.isRevision && t.revisesThought)
        .map((t) => t.revisesThought!)
    );

    // Build set of thoughts with blocker extensions
    const blockerThoughts = new Set(
      sessionThoughts
        .filter((t) => t.extensions?.some((e) => e.impact === 'blocker'))
        .map((t) => t.thoughtNumber)
    );

    // Main flow subgraph
    lines.push('  subgraph MainFlow["🧠 Main Reasoning"]');

    // Add start node
    if (mainThoughts.length > 0) {
      lines.push(`    start((Start)) --> ${mainThoughts[0].thoughtNumber};`);
    }

    // Process each main thought
    for (let i = 0; i < mainThoughts.length; i++) {
      const t = mainThoughts[i];
      const label = sanitizeForMermaid(t.thought.substring(0, 25));
      const confLabel = t.confidence ? `<br/>conf:${t.confidence}` : '';
      const subStepsLabel = t.subSteps && t.subSteps.length > 0 ? `<br/>📋${t.subSteps.length} steps` : '';
      const altsLabel = t.alternatives && t.alternatives.length > 0 ? `<br/>⚖️${t.alternatives.length} alts` : '';

      // Determine style class with priority: blocker > revised > lowConf > highConf > normal
      let styleClass = 'normal';
      if (blockerThoughts.has(t.thoughtNumber)) {
        styleClass = 'blocker';
      } else if (revisedThoughts.has(t.thoughtNumber)) {
        styleClass = 'revised';
      } else if (t.confidence && t.confidence < 5) {
        styleClass = 'lowConf';
      } else if (t.confidence && t.confidence >= 8) {
        styleClass = 'highConf';
      }

      lines.push(`    ${t.thoughtNumber}["#${t.thoughtNumber}: ${label}...${confLabel}${subStepsLabel}${altsLabel}"]:::${styleClass};`);

      // Edge to next thought
      if (i < mainThoughts.length - 1) {
        lines.push(`    ${t.thoughtNumber} --> ${mainThoughts[i + 1].thoughtNumber};`);
      }
    }
    lines.push('  end');

    // Extensions subgraph (if any)
    const hasExtensions = mainThoughts.some((t) => t.extensions && t.extensions.length > 0);
    if (hasExtensions) {
      lines.push('  subgraph Extensions["🔍 Deep Analysis"]');
      for (const t of mainThoughts) {
        if (t.extensions && t.extensions.length > 0) {
          t.extensions.forEach((ext, idx) => {
            const extId = `ext_${t.thoughtNumber}_${idx}`;
            const extLabel = sanitizeForMermaid(ext.content.substring(0, 20));
            const extClass = ext.impact === 'blocker' ? 'blocker' : ext.impact === 'high' ? 'highImpact' : 'ext';
            const icon = ext.impact === 'blocker' ? '🚫' : ext.impact === 'high' ? '⚠️' : '📝';
            lines.push(`    ${extId}[/"${icon} ${ext.type}: ${extLabel}..."/]:::${extClass};`);
          });
        }
      }
      lines.push('  end');
      // Connect extensions to main thoughts
      for (const t of mainThoughts) {
        if (t.extensions && t.extensions.length > 0) {
          t.extensions.forEach((_, idx) => {
            const extId = `ext_${t.thoughtNumber}_${idx}`;
            lines.push(`  ${t.thoughtNumber} -.-> ${extId};`);
          });
        }
      }
    }

    // Revisions subgraph (if any)
    const revisions = sessionThoughts.filter((t) => t.isRevision);
    if (revisions.length > 0) {
      lines.push('  subgraph Revisions["🔄 Revisions"]');
      revisions.forEach((rev, idx) => {
        const revId = `rev_${rev.revisesThought}_${idx}`;
        const revLabel = sanitizeForMermaid(rev.thought.substring(0, 20));
        lines.push(`    ${revId}["🔄 ${revLabel}..."]:::revision;`);
      });
      lines.push('  end');
      // Connect revisions to targets
      revisions.forEach((rev, idx) => {
        const revId = `rev_${rev.revisesThought}_${idx}`;
        lines.push(`  ${revId} ==> ${rev.revisesThought};`);
      });
    }

    // Branch subgraphs
    for (const [branchId, branchThoughts] of branches) {
      const sessionBranchThoughts = branchThoughts.filter((bt) => {
        return thoughtHistory.indexOf(bt) >= sessionStartIndex;
      });

      if (sessionBranchThoughts.length > 0) {
        lines.push(`  subgraph Branch_${branchId}["🌿 Branch: ${branchId}"]`);
        sessionBranchThoughts.forEach((bt, idx) => {
          const branchNodeId = `branch_${branchId}_${idx}`;
          const btLabel = sanitizeForMermaid(bt.thought.substring(0, 20));
          lines.push(`    ${branchNodeId}["${btLabel}..."]:::branch;`);
        });
        lines.push('  end');
        // Connect branches to source thoughts
        sessionBranchThoughts.forEach((bt, idx) => {
          if (bt.branchFromThought) {
            const branchNodeId = `branch_${branchId}_${idx}`;
            lines.push(`  ${bt.branchFromThought} -.->|${branchId}| ${branchNodeId};`);
          }
        });
      }
    }

    // Style definitions with visual intelligence
    lines.push('  classDef normal fill:#e1f5fe,stroke:#01579b;');
    lines.push('  classDef highConf fill:#e1f5fe,stroke:#ffd700,stroke-width:3px;');
    lines.push('  classDef lowConf fill:#ffecb3,stroke:#ff6f00;');
    lines.push('  classDef blocker fill:#ffcdd2,stroke:#b71c1c,stroke-width:3px;');
    lines.push('  classDef revised fill:#e0e0e0,stroke:#9e9e9e,stroke-dasharray:5 5;');
    lines.push('  classDef highImpact fill:#fff3e0,stroke:#e65100;');
    lines.push('  classDef ext fill:#f3e5f5,stroke:#7b1fa2;');
    lines.push('  classDef revision fill:#e8f5e9,stroke:#2e7d32;');
    lines.push('  classDef branch fill:#e0f2f1,stroke:#00695c;');

    return lines.join('\n');
  }
}
