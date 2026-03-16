// ============================================================
// PROJECT MAP — pure helpers for project map generation
// ============================================================

import { ProjectMap } from './workspace';

export function sanitizeMapSegment(value: string): string {
  const cleaned = value.normalize('NFKD').replace(/[^\x00-\x7F]/g, '');
  const normalized = cleaned.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || 'root';
}

export function formatProjectMapMarkdown(map: ProjectMap): string {
  const lines: string[] = [];
  lines.push('# Project Map');
  lines.push(`Updated: ${new Date(map.lastUpdated).toISOString()}`);
  lines.push('');
  lines.push('## Tree');
  lines.push(map.tree ? map.tree : '- (empty)');
  lines.push('');
  lines.push('## Key Files');
  if (map.keyFiles.length === 0) {
    lines.push('- (none)');
  } else {
    for (const file of map.keyFiles) {
      lines.push(`- ${file}`);
    }
  }
  lines.push('');
  lines.push('## Modules');
  if (map.modules.length === 0) {
    lines.push('- (none)');
  } else {
    for (const mod of map.modules) {
      lines.push(`- ${mod.name}: ${mod.summary}`);
      for (const file of mod.files) {
        lines.push(`  - ${file}`);
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}
