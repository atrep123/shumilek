import re

with open('src/extension.ts', 'r', encoding='utf-8') as f:
    text = f.read()

impl_fetch = r"""      case 'fetch_webpage': {
        const url = asString(args.url);
        if (!url) return { ok: false, tool: name, message: 'url je povinne' };

        try {
          const fetch = require('node-fetch');
          const response = await fetch(url);
          const html = await response.text();

          // simple string manipulation to strip script and style tags, to save tokens
          let stripped = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
          stripped = stripped.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
          stripped = stripped.replace(/<[^>]+>/g, ' '); // remove remaining html tags
          stripped = stripped.replace(/\s+/g, ' ').trim(); // normalize whitespace

          return { ok: true, tool: name, result: stripped.substring(0, 50000) };
        } catch (e) {
          return { ok: false, tool: name, message: 'Failed to fetch: ' + String(e) };
        }
      }

      default:"""

pattern = r"      default:"
text = text.replace(pattern, impl_fetch)

with open('src/extension.ts', 'w', encoding='utf-8') as f:
    f.write(text)

print("Injected fetch_webpage.")
