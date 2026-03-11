import re

with open('src/extension.ts', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update requireToolCall regex to include "run_terminal_command" or "terminal" or "spust" or "prikaz"
text = re.sub(
    r"requireMutation = /\(.*?\)/\.test\(normalized\)",
    r"requireMutation = /(vytvo[rř]|ulo[zž]|zapi[sš]|napi[sš]|uprav|upravit|přepi[sš]|prepis|přidej|pridej|sma[zž]|smaz|smazat|prejmenuj|přejmenuj|rename|delete|write|edit|modify|create|replace|patch|apply_patch|write_file|replace_lines|run_terminal_command|spust|spustit|prikaz|přikaz|terminal)/.test(normalized)",
    text
)

text = re.sub(
    r"requireToolCall = requireMutation \|\| /\(.*?\)/\.test\(normalized\)",
    r"requireToolCall = requireMutation || /(přečti|precti|zobraz|otevri|otevř|najdi|hledej|search|list_files|read_file|get_active_file|symboly|symbol|definice|definition|reference|references|diagnostik|diagnostics|lsp|get_symbols|get_workspace_symbols|get_definition|get_references|get_type_info|get_diagnostics|run_terminal_command)/.test(normalized)",
    text
)

# 2. Add to tool lists in buildToolInstructions
text = text.replace("'- delete_file { path: string }'", "'- delete_file { path: string }',\n    '- run_terminal_command { command: string, timeoutMs?: number }'")
text = text.replace("'delete_file'\n  ];", "'delete_file',\n    'run_terminal_command'\n  ];")

with open('src/extension.ts', 'w', encoding='utf-8') as f:
    f.write(text)

print("Updated prompt instructions and regexes.")
