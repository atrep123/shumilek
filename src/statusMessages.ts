export const PIPELINE_STATUS_ICONS = {
  chat: '💬',
  history: '📋',
  svedomi: '🧠',
  tools: '🛠️',
  editor: '✍️'
} as const;

export const PIPELINE_STATUS_TEXT = {
  generatingResponse: 'Generuji odpoved...',
  checkingHistory: 'Kontrola historie odpovedi...',
  svedomiValidation: 'Svedomi kontroluje odpoved...',
  toolsActive: 'Nastroje aktivni, pracuji se soubory...',
  editorApplying: 'Editor mode: applying actions...'
} as const;
