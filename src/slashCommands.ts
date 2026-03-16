/**
 * Slash Commands — Chat-inline commands inspired by OpenClaw.
 *
 * Parses `/command [args]` from user input and executes built-in actions
 * without sending to the AI model.
 */

import type { ChatMessage, GuardianStats } from './types';

export interface SlashCommandContext {
  messages: ChatMessage[];
  guardianStats: GuardianStats;
  modelInfo: {
    main: string;
    writer: string;
    rozum: string;
    svedomi: string;
    backend: string;
    baseUrl: string;
  };
  orchestrationState: string;
  svedomiCacheSize: number;
  responseHistoryStats: { total: number; avgScore: number };
  /** callback to persist messages */
  saveMessages: () => Promise<void>;
  /** callback to clear guardian history */
  resetGuardian: () => void;
  /** callback to run doctor */
  runDoctor: () => Promise<string>;
  /** callback to compact session */
  compactSession: () => Promise<{ compacted: boolean; saved: number }>;
}

export interface SlashCommandResult {
  handled: boolean;
  /** Markdown response to show in chat (assistant message) */
  response?: string;
  /** If true, clear the chat history */
  clearHistory?: boolean;
}

const HELP_TEXT = `### Dostupné příkazy

| Příkaz | Popis |
|--------|-------|
| \`/status\` | Model, statistiky, stav pipeline |
| \`/stats\` | Guardian / halucinace / Svedomi metriky |
| \`/new\` | Nová konverzace (smaže historii) |
| \`/compact\` | Komprimuje kontext (zachová fakta) |
| \`/doctor\` | Diagnostika (Ollama, modely, konfigurace) |
| \`/help\` | Tento výpis |
`;

export function isSlashCommand(input: string): boolean {
  return /^\s*\/[a-zA-Z]/.test(input);
}

export async function executeSlashCommand(
  input: string,
  ctx: SlashCommandContext
): Promise<SlashCommandResult> {
  const trimmed = input.trim();
  const match = trimmed.match(/^\/(\w+)(?:\s+(.*))?$/);
  if (!match) {
    return { handled: false };
  }

  const command = match[1].toLowerCase();
  const _args = match[2]?.trim() ?? '';

  switch (command) {
    case 'help':
    case 'h':
      return { handled: true, response: HELP_TEXT };

    case 'status':
    case 's':
      return { handled: true, response: formatStatus(ctx) };

    case 'stats':
      return { handled: true, response: formatStats(ctx) };

    case 'new':
    case 'reset':
      return {
        handled: true,
        response: '🗑️ Konverzace vymazána.',
        clearHistory: true
      };

    case 'compact':
      return await handleCompact(ctx);

    case 'doctor':
    case 'doc':
      return await handleDoctor(ctx);

    default:
      return {
        handled: true,
        response: `Neznámý příkaz \`/${command}\`. Zkus \`/help\`.`
      };
  }
}

function formatStatus(ctx: SlashCommandContext): string {
  const m = ctx.modelInfo;
  const msgCount = ctx.messages.length;
  const userCount = ctx.messages.filter(m => m.role === 'user').length;
  return `### Status

| Položka | Hodnota |
|---------|---------|
| Backend | \`${m.backend}\` → \`${m.baseUrl}\` |
| Hlavní model | \`${m.main}\` |
| Writer model | \`${m.writer}\` |
| Rozum (planner) | \`${m.rozum}\` |
| Svedomi (validator) | \`${m.svedomi}\` |
| Zpráv v historii | ${msgCount} (${userCount} uživatelských) |
| Orchestrace | ${ctx.orchestrationState} |
| Svedomi cache | ${ctx.svedomiCacheSize} položek |
`;
}

function formatStats(ctx: SlashCommandContext): string {
  const g = ctx.guardianStats;
  const h = ctx.responseHistoryStats;
  return `### Statistiky session

**Guardian**
- Kontrol celkem: ${g.totalChecks}
- Smyčky nalezeny: ${g.loopsDetected}
- Repetice opraveny: ${g.repetitionsFixed}
- Retry triggered: ${g.retriesTriggered}
- Truncace opraveny: ${g.truncationsRepaired}

**Halucinace**
- Detekovány: ${g.hallucinationsDetected}
- Podobné odpovědi blokované: ${g.similarResponsesBlocked}

**Svedomi (mini-model)**
- Validací: ${g.miniModelValidations}
- Odmítnutí: ${g.miniModelRejections}

**Historie odpovědí**
- Celkem: ${h.total}
- Průměrné skóre: ${h.avgScore.toFixed(1)}/10
`;
}

async function handleCompact(ctx: SlashCommandContext): Promise<SlashCommandResult> {
  const result = await ctx.compactSession();
  if (!result.compacted) {
    return {
      handled: true,
      response: '📋 Kontext je dostatečně krátký, komprese není potřeba.'
    };
  }
  return {
    handled: true,
    response: `📋 Kontext komprimován. Ušetřeno ~${result.saved} zpráv, klíčová fakta zachována.`
  };
}

async function handleDoctor(ctx: SlashCommandContext): Promise<SlashCommandResult> {
  const report = await ctx.runDoctor();
  return { handled: true, response: report };
}
