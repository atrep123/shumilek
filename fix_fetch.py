with open('src/extension.ts', 'r', encoding='utf-8') as f:
    text = f.read()

text = text.replace("result: stripped.substring(0, 50000)", "message: stripped.substring(0, 50000)")

with open('src/extension.ts', 'w', encoding='utf-8') as f:
    f.write(text)

print("Fixed return type for fetch_webpage.")
