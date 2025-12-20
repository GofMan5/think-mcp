/**
 * ExportService - Export session as Markdown or JSON report
 * Stateless service - receives data as parameters
 */

import type { ThoughtRecord, DeadEnd } from '../types/thought.types.js';

/** Export options */
export interface ExportOptions {
  format?: 'markdown' | 'json';
  includeMermaid?: boolean;
}

/** Session data for export */
export interface ExportSessionData {
  thoughts: ThoughtRecord[];
  branches: Map<string, ThoughtRecord[]>;
  deadEnds: DeadEnd[];
  sessionGoal?: string;
  averageConfidence?: number;
  mermaidDiagram?: string;
}

export class ExportService {
  /**
   * Export session as Markdown or JSON report
   * @param data - Session data to export
   * @param options - Export options
   */
  export(data: ExportSessionData, options: ExportOptions = {}): string {
    const { format = 'markdown', includeMermaid = true } = options;
    const { thoughts, branches, deadEnds, sessionGoal, averageConfidence, mermaidDiagram } = data;

    if (thoughts.length === 0) {
      return format === 'json'
        ? JSON.stringify({ error: 'No thoughts recorded in current session' })
        : '# Think Session Report\n\n*No thoughts recorded in current session.*';
    }

    if (format === 'json') {
      return JSON.stringify(
        {
          goal: sessionGoal,
          thoughts,
          branches: Array.from(branches.entries()),
          deadEnds,
          averageConfidence,
          exportedAt: new Date().toISOString(),
        },
        null,
        2
      );
    }

    // Markdown format
    return this.generateMarkdown(data, includeMermaid);
  }

  /**
   * Generate Markdown report
   */
  private generateMarkdown(data: ExportSessionData, includeMermaid: boolean): string {
    const { thoughts, branches, deadEnds, sessionGoal, averageConfidence, mermaidDiagram } = data;
    const sections: string[] = [
      '# Think Session Report',
      `**Date:** ${new Date().toISOString().split('T')[0]}`,
      '',
    ];

    // Goal section
    if (sessionGoal) {
      sections.push(`## 🎯 Goal`, sessionGoal, '');
    }

    // Summary section
    sections.push(
      '## 📊 Summary',
      `- **Total thoughts:** ${thoughts.length}`,
      `- **Branches:** ${branches.size}`,
      `- **Dead ends:** ${deadEnds.length}`,
      `- **Average confidence:** ${averageConfidence ?? 'N/A'}`,
      ''
    );

    // Thoughts section
    sections.push('## 💭 Thoughts', '');
    thoughts.forEach((t) => {
      const confStr = t.confidence ? ` [confidence: ${t.confidence}/10]` : '';
      const revStr = t.isRevision ? ` *(revision of #${t.revisesThought})*` : '';
      const branchStr = t.branchFromThought ? ` *(branch from #${t.branchFromThought})*` : '';

      sections.push(`### Thought #${t.thoughtNumber}${confStr}${revStr}${branchStr}`);
      sections.push(t.thought);

      if (t.subSteps && t.subSteps.length > 0) {
        sections.push('', '**Sub-steps:**');
        t.subSteps.forEach((s) => sections.push(`- ${s}`));
      }

      if (t.alternatives && t.alternatives.length > 0) {
        sections.push('', `**Alternatives considered:** ${t.alternatives.join(' | ')}`);
      }

      if (t.extensions && t.extensions.length > 0) {
        sections.push('', '**Extensions:**');
        t.extensions.forEach((e) => {
          const icon =
            e.type === 'innovation' ? '💡' : e.type === 'optimization' ? '⚡' : e.type === 'polish' ? '✨' : '📝';
          sections.push(`- ${icon} **[${e.type.toUpperCase()}]** (${e.impact}): ${e.content}`);
        });
      }

      sections.push('');
    });

    // Dead Ends section
    if (deadEnds.length > 0) {
      sections.push('## 💀 Dead Ends (Rejected Paths)', '');
      deadEnds.forEach((de, idx) => {
        sections.push(`### Dead End #${idx + 1}`);
        sections.push(`- **Path:** [${de.path.join(' → ')}]`);
        sections.push(`- **Reason:** ${de.reason}`);
        sections.push(`- **Recorded:** ${de.timestamp}`);
        sections.push('');
      });
    }

    // Mermaid diagram
    if (includeMermaid && mermaidDiagram) {
      sections.push('## 🔀 Diagram', '', '```mermaid', mermaidDiagram, '```', '');
    }

    return sections.join('\n');
  }
}
