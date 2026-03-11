import re

with open('src/extension.ts', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update requireToolCall
text = re.sub(
    r"requireToolCall = requireMutation \|\| /\(.*?\)/\.test\(normalized\)",
    r"requireToolCall = requireMutation || /(přečti|precti|zobraz|otevri|otevř|najdi|hledej|search|list_files|read_file|get_active_file|symboly|symbol|definice|definition|reference|references|diagnostik|diagnostics|lsp|get_symbols|get_workspace_symbols|get_definition|get_references|get_type_info|get_diagnostics|run_terminal_command|fetch|web|stahni|stáhni|url)/.test(normalized)",
    text
)

# 2. Add to buildToolInstructions
text = text.replace(
    "'- search_in_files { query: string, glob?: string, maxResults?: number }',",
    "'- search_in_files { query: string, glob?: string, maxResults?: number, isRegex?: boolean }',"
)
text = text.replace(
    "'- run_terminal_command { command: string, timeoutMs?: number }',",
    "'- run_terminal_command { command: string, timeoutMs?: number }',\n    '- fetch_webpage { url: string }',"
)

# 3. Add to buildToolOnlyPrompt
text = text.replace(
    "'run_terminal_command'\n  ];",
    "'run_terminal_command',\n    'fetch_webpage'\n  ];"
)

with open('src/extension.ts', 'w', encoding='utf-8') as f:
    f.write(text)

print("Injected UI definitions for fetch_webpage and regex")
