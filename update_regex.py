import re

with open('src/extension.ts', 'r', encoding='utf-8') as f:
    text = f.read()

impl_search = r"""      case 'search_in_files': {
        const query = asString(args.query);
        if (!query) return { ok: false, tool: name, message: 'query je povinny' };
        
        const isRegex = args.isRegex === true;
        let queryRegex: RegExp | undefined;
        if (isRegex) {
          try {
             queryRegex = new RegExp(query, 'g');
          } catch (e) {
             return { ok: false, tool: name, message: 'Neplatny regex: ' + String(e) };
          }
        }
        
        const glob = asString(args.glob);
        const maxResults = clampNumber(args.maxResults, DEFAULT_MAX_SEARCH_RESULTS, 1, 200);
        const matches: Array<{ path: string; line: number; text: string }> = [];
        const include = glob ?? '**/*';
        const maxFilesToScan = Math.min(500, Math.max(50, maxResults * 25));
        const files = await vscode.workspace.findFiles(include, DEFAULT_EXCLUDE_GLOB, maxFilesToScan);
        let skippedBinary = 0;
        let skippedLarge = 0;

        for (const uri of files) {
          if (matches.length >= maxResults) break;
          const readResult = await readFileForTool(uri, DEFAULT_MAX_READ_BYTES);
          if (readResult.text === undefined) {
            if (readResult.binary) skippedBinary++;
            if (readResult.size && readResult.size > DEFAULT_MAX_READ_BYTES) skippedLarge++;
            continue;
          }

          const lines = splitLines(readResult.text);
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= maxResults) break;
            const lineText = lines[i];
            
            const isMatch = isRegex ? queryRegex!.test(lineText) : lineText.includes(query);
            if (isRegex) queryRegex!.lastIndex = 0;
            
            if (isMatch) {
              matches.push({
                path: getRelativePathForWorkspace(uri),
                line: i + 1,
                text: lineText.trim()
              });
            }
          }
        }"""

pattern = r"      case 'search_in_files': \{\s*const query = asString\(args\.query\).*?if \(lineText\.includes\(query\)\) \{\s*matches\.push\(\{\s*path: getRelativePathForWorkspace\(uri\),\s*line: i \+ 1,\s*text: lineText\.trim\(\)\s*\}\);\s*\}\s*\}\s*\}"
text = re.sub(pattern, impl_search, text, flags=re.DOTALL)

with open('src/extension.ts', 'w', encoding='utf-8') as f:
    f.write(text)

print("Injected regex search.")
