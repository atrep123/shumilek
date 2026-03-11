import re

with open('src/extension.ts', 'r', encoding='utf-8') as f:
    text = f.read()

impl = """      case 'run_terminal_command': {
        const command = asString(args.command);
        if (!command) return { ok: false, tool: name, message: 'command je povinny' };
        
        let timeoutMs = clampNumber(args.timeoutMs, 30000, 1000, 120000);
        
        let approved = true;
        if (confirmEdits && !autoApprove.edit) {
          const choice = await vscode.window.showInformationMessage(
            `Spustit příkaz v terminálu?\\n\\n${command}`,
            { modal: true },
            'Spustit',
            'Zamítnout'
          );
          approved = choice === 'Spustit';
        }
        if (!approved) return { ok: true, tool: name, approved: false, message: 'spusteni zamitnuto uzivatelem' };
        
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        
        return new Promise((resolve) => {
           exec(command, { cwd, timeout: timeoutMs }, (error, stdout, stderr) => {
             resolve({
               ok: true,
               tool: name,
               approved: true,
               message: 'prikaz dokoncen',
               data: {
                 stdout: stdout ? stdout.slice(0, 15000) : '',
                 stderr: stderr ? stderr.slice(0, 15000) : '',
                 exitCode: error ? (error as any).code || 1 : 0,
                 error: error ? error.message : undefined
               }
             });
           });
        });
      }
      default:"""

text = text.replace("      default:", impl)

with open('src/extension.ts', 'w', encoding='utf-8') as f:
    f.write(text)

print("Injected run_terminal_command into executeToolCall")
