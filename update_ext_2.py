import re

with open('src/extension.ts', 'r', encoding='utf-8') as f:
    text = f.read()

# Změny v Tooling promptu - buildToolInstructions
old_tool_instructions = """    'TOOLING:',
    'Mas pristup k nastrojum pro praci se soubory. Kdyz potrebujes cist nebo upravovat soubory, pouzij nastroj.',
    'Format tool callu (vrat pouze tool_call bloky, bez dalsiho textu):',
    '<tool_call>{\"name\":\"read_file\",\"arguments\":{\"path\":\"src/extension.ts\",\"startLine\":1,\"endLine\":200}}</tool_call>',
    'Po kazdem tool callu dostanes vysledek:',
    '<tool_result>{\"ok\":true,\"tool\":\"read_file\",\"data\":{...}}</tool_result>',
    'read_file uklada hash souboru; pred replace_lines vzdy pouzij read_file.',
    `Auto-save slozka: ${autoSaveDir}.`,
    'Kdyz nevis cestu, pouzij pick_save_path (bez dialogu) a potom write_file s vracenou cestou.',
    'U pick_save_path pouzij title/suggestedName/extension pro chytre pojmenovani.',
    'Kdyz neuvedes path u write_file/replace_lines, pouzije se aktivni soubor; write_file bez aktivniho souboru ulozi do auto-save slozky.',
    'Cilovy soubor vol sam: 1) explicitne z dotazu, 2) aktivni soubor pokud sedi tema, 3) relevantni soubory z kontextu, 4) list_files/search_in_files, 5) novy soubor do auto-save.',
    'Nezadej si o cestu, pokud to neni nezbytne; rozhodni a zapis.',
    'Pokud je workspace multi-root, pouzij cestu ve tvaru root/soubor.',"""

new_tool_instructions = """    'TOOLING:',
    'You have access to tools for file operations and terminal execution. Use tools when you need to read, edit files or run commands.',
    'Tool call format (return ONLY tool_call blocks, without conversational text):',
    '<tool_call>{\"name\":\"read_file\",\"arguments\":{\"path\":\"src/extension.ts\",\"startLine\":1,\"endLine\":200}}</tool_call>',
    'After each tool call, you will receive a result:',
    '<tool_result>{\"ok\":true,\"tool\":\"read_file\",\"data\":{...}}</tool_result>',
    'read_file caches the file hash; ALWAYS use read_file before replace_lines.',
    `Auto-save folder: ${autoSaveDir}.`,
    'If you do not know the path, use pick_save_path and then write_file with the returned path.',
    'Use title/suggestedName/extension in pick_save_path for smart naming.',
    'If path is omitted in write_file/replace_lines, the active file is used. write_file without an active file saves to the auto-save folder.',
    'Decide the target file yourself: 1) explicit in query, 2) active file if relevant, 3) relevant context files, 4) list_files/search_in_files, 5) new file in auto-save.',
    'Do not ask for a path unless strictly necessary; make a decision and write.',
    'If the workspace is multi-root, use the format root/file.',"""

text = text.replace(old_tool_instructions, new_tool_instructions)

old_pravidla = """    'Pravidla:',
    '- Pri editaci nejdriv nacti soubor a pouzij replace_lines s presnymi radky.',
    '- Nehlasej, ze jsi soubor cetl/upravil bez tool_result.',
    '- Kdyz dostanes tool_result s approved:false, navrhni alternativu nebo se zeptej.'"""

new_pravidla = """    'RULES:',
    '- When editing, read the file first and use replace_lines with precise line content matches.',
    '- Never report having read/modified a file without getting a tool_result back first.',
    '- If you receive a tool_result with approved:false, suggest an alternative or ask the user.',
    '- Wait for terminal command output before proceeding to next steps.'"""

text = text.replace(old_pravidla, new_pravidla)
text = text.replace("    'Dostupne nastroje:',", "    'AVAILABLE TOOLS:',")

with open('src/extension.ts', 'w', encoding='utf-8') as f:
    f.write(text)

print("Updated Tool instructions to English.")
