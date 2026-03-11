import re

with open('src/toolingProtocol.ts', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace("const EDIT_TOOL_NAMES = new Set<string>([\n  'apply_patch',", "const EDIT_TOOL_NAMES = new Set<string>([\n  'run_terminal_command',\n  'apply_patch',")

with open('src/toolingProtocol.ts', 'w', encoding='utf-8') as f:
    f.write(text)

print("Added to toolingProtocol")
