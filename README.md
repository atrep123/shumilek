# Šumílek – AI Chat pro VS Code (s Ollama)

Lokální AI asistent pro programování s pokročilou ochranou proti zaseknutí a opakování.

## ✨ Funkce
- 💬 **Chat panel** přímo ve VS Code
- 🔄 **Streaming odpovědí** v reálném čase
- 📝 **Historie konverzace** s perzistencí napříč relacemi
- � **Časové razítka** u zpráv (čas odeslání)
- 📋 **Kopírování odpovědí** – tlačítko pro zkopírování jednotlivých zpráv a tlačítko "Zkopírovat vše" pro rychlé získání všech AI odpovědí
- 📎 **Kopírování bloků kódu** – každé code-block má tlačítko "Kopírovat kód"
- 🔁 **Regenerovat** – tlačítko pro opětovné vygenerování poslední odpovědi
- ↕️ **Sbalitelné dlouhé zprávy** – "Zobrazit více / Skrýt" pro lepší čitelnost
- ↩️ **Vrátit (Undo)** po vymazání historie (snackbar s tlačítkem)
- �🛡️ **Response Guardian** – detekce smyček, opakování a zaseknutí modelu
- 🤖 **Mini-model validátor** (qwen2.5:0.5b) – automatická kontrola kvality odpovědí
- 🔁 **Automatické retry** při detekci problémů
- 📂 **Přidávání souborů** z editoru do kontextu chatu
- ⚙️ **Plně konfigurovatelné** (model, systémový prompt, timeouty, atd.)

## 🚀 Instalace
```bash
cd shumilek
npm install
npm run compile
```

## 🎯 Spuštění
1. Otevři složku `shumilek` ve VS Code
2. Stiskni `F5` (spustí Extension Development Host)
3. V paletě příkazů (`Ctrl+Shift+P`): **"Šumílek: Otevřít Chat"**
4. Nebo použij zkratku: `Ctrl+Shift+S`

## ⚙️ Nastavení
Ve VS Code Settings (`Ctrl+,`) najdeš:

### Základní
- `shumilek.model` – Model Ollama (výchozí: `deepseek-coder-v2:16b`)
- `shumilek.baseUrl` – Ollama endpoint (výchozí: `http://localhost:11434`)
- `shumilek.systemPrompt` – Systémový prompt pro model
- `shumilek.timeout` – Timeout v sekundách (výchozí: 120)

### Guardian & Validace
- `shumilek.guardianEnabled` – Zapnout Response Guardian (výchozí: `true`)
- `shumilek.miniModelEnabled` – Zapnout mini-model validátor (výchozí: `true`)
- `shumilek.miniModel` – Model pro validaci (výchozí: `qwen2.5:0.5b`)
- `shumilek.maxRetries` – Max. pokusů při detekci problému (výchozí: 2)

## 🛡️ Response Guardian
Automaticky detekuje a opravuje:
- ♾️ **Nekonečné smyčky** (repeating patterns)
- 🔁 **Nadměrné opakování** slov a vět
- 🚫 **Zaseklé odpovědi** (stuck generation)
- ⏱️ **Stall detection** (10s bez odpovědi = stop)
- 🧹 Čistění a zkracování problematických odpovědí

## 🤖 Mini-model Validátor
Malý AI model (qwen2.5:0.5b) validuje každou odpověď:
- 🎯 Hodnotí relevanci, smysluplnost, kompletnost
- 📊 Skóre 1-10 + textové vysvětlení
- ⚠️ Automatický retry při velmi nízkém skóre (≤3)
- 💡 Upozornění v UI při středním skóre (4-5)

## 📋 Příkazy
- **Šumílek: Otevřít Chat** – Otevře chat panel
- **Šumílek: Exportovat poslední odpověď do souboru** – Uloží poslední odpověď (preferuje code-block) do souboru, např. `.ino`
- **Šumílek: Vložit poslední odpověď do editoru** – Vloží poslední odpověď (preferuje code-block) na kurzor nebo nahradí označený výběr
- **Šumílek: Vymazat historii** – Smaže celou konverzační historii
- **Šumílek: Guardian statistiky** – Zobrazí statistiky Guardian & mini-modelu

## 🔧 Požadavky
- ✅ **Ollama server** běžící na `http://localhost:11434`
- ✅ Stažený model: `ollama pull deepseek-coder-v2:16b`
- ✅ (Volitelně) Mini-model: `ollama pull qwen2.5:0.5b`

## 💡 Použití
1. Napiš dotaz do textového pole
2. Odešli: kliknutím na ➤ nebo `Ctrl+Enter`
3. Sleduj real-time streaming odpovědi
4. Použij tlačítko **🔁 Regenerovat** pro vygenerování poslední odpovědi znovu, nebo **📋 Zkopírovat vše** pro zkopírování všech odpovědí od AI
5. Guardian automaticky kontroluje kvalitu
6. Mini-model validuje finální výstup
7. Historie se ukládá automaticky

### Přidání souboru
- Klikni na **"Přidat soubor"** pro vložení aktivního editoru do kontextu
- Soubor se přidá jako code block do promptu

## 📊 Statistiky
Kliknutím na 🛡️ v headeru nebo příkazem **Guardian statistiky** zobrazíš:
- Počet kontrol
- Detekované smyčky
- Opravená opakování
- Mini-model validace a zamítnutí

## 🔒 Bezpečnost
- ✅ Žádná data neopouští lokální prostředí
- ✅ Komunikace pouze s lokálním Ollama serverem
- ✅ Žádné externí API volání
- ✅ Webview s Content Security Policy

## 📝 Poznámky
- **Streaming**: Odpovědi přicházejí v reálném čase
- **Perzistence**: Historie přežije restart VS Code
- **Časové razítka**: Každá zpráva obsahuje čas odeslání
- **Sbalitelné zprávy**: Dlouhé odpovědi jsou implicitně sbalené ("Zobrazit více"), aby byl chat přehlednější
- **Kopírování**: Tlačítka pro kopírování jednotlivých zpráv a bloků kódu; tlačítko "Zkopírovat vše" zkopíruje všechny AI odpovědi
- **Undo**: Po vymazání historie je zobrazen snackbar s možností "Vrátit" pro obnovení historie
- **Unicode-safe**: Správné zpracování emoji, CJK znaků, atd.
- **Performance**: Guardian omezen na prvních 5000 znaků pro rychlost
- **Guardian animace**: Důrazné, ale nenápadné animace upozornění, které usnadňují diagnostiku problémů

## 🐛 Debug
Logy najdeš v:
- **Output Channel**: "Šumílek" (View → Output → Šumílek)
- Guardian a mini-model eventy se logují automaticky

## ✅ Nedávné opravy
- Normalizována škála priorit úkolů na 1–10 (dříve inconsistentní 0.1–1.0 vs 1–10).
- Opravené chybné emoji znaky v UI (`�` → `🧠`).
- UI pro úpravu priority nyní používá rozsah 1–10 a hvězdičky jsou omezeny na 10.
- Přidány `activationEvents` do `package.json` pro správné aktivování příkazů.
- Přidána UI: **🔁 Regenerovat**, **📋 Zkopírovat vše**, tlačítka **Kopírovat zprávu** a **Kopírovat kód**.
- Přidána časová razítka u zpráv a tlačítko "Zobrazit více / Skrýt" pro dlouhé odpovědi.
- Implementováno **Vrátit** (Undo) pro vymazání historie pomocí snackbaru a obnova historie.
- Vylepšena vizuální notifikace Guardianu (subtilní animace) a drobné UX opravy.

