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
            if (isRegex) queryRegex!.lastIndex = 0; // reset for safety
            
            if (isMatch) {
              matches.push({
                path: getRelativePathForWorkspace(uri),
                line: i + 1,
                text: lineText.trim()
              });
            }
          }
        }"""

# Replace search_in_files case
text = re.sub(r"      case 'search_in_files': \{[\s\S]*?          \}[\s\S]*?        \}", impl_search, text, count=1)

fetch_impl = """      case 'fetch_webpage': {
        const urlArgs = asString(args.url);
        if (!urlArgs) return { ok: false, tool: name, message: 'url je povinne' };
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);
          const res = await fetch(urlArgs, { signal: controller.signal as any });
          clearTimeout(timeout);
          if (!res.ok) return { ok: false, tool: name, message: `Status: ${res.status}` };
          const html = await res.text();
          // Minimalistic HTML strip to fit context window
          const stripped = html
            .replace(/<script\\b[^<]*(?:(?!<\\/script>)<[^<]*)*<\\/script>/gi, '')
            .replace(/<style\\b[^<]*(?:(?!<\\/style>)<[^<]*)*<\\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\\s+/g, ' ')
            .trim();
          return { ok: true, tool: name, data: { url: urlArgs, text: stripped.slice(0, 15000) } };
        } catch (e: any) {
          return { ok: false, tool: name, message: `Chyba pri fetch: ${e.message}` };
        }
      }
      default:"""

text = text.replace("      default:", fetch_impl)

with open('src/extension.ts', 'w', encoding='utf-8') as f:
    f.write(text)

print("Injected logic for search_in_files and fetch_webpage")
