import * as vscode from 'vscode';
import { ChatMessage } from './types';
import { getNonce } from './utils';
import { resolveTimeoutMs, getToolsEnabledSetting } from './configResolver';

// ============================================================
// MINIMAL WEBVIEW FOR DEBUGGING
// ============================================================

export function getMinimalWebviewContent(_webview: vscode.Webview): string {
  const nonce = getNonce();

  return '<!DOCTYPE html>' +
    '<html lang="cs">' +
    '<head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\';">' +
    '<style>' +
    'body { font-family: sans-serif; background: #1e1e1e; color: white; padding: 20px; }' +
    '#chat { min-height: 200px; border: 1px solid #444; padding: 10px; margin-bottom: 10px; }' +
    '#prompt { width: 80%; padding: 8px; }' +
    '#send-btn { padding: 8px 16px; }' +
    '.message { padding: 8px; margin: 4px 0; border-radius: 4px; }' +
    '.user { background: #264f78; }' +
    '.assistant { background: #3c3c3c; }' +
    '</style>' +
    '</head>' +
    '<body>' +
    '<h2>Šumílek Chat - MINIMAL TEST</h2>' +
    '<div id="status-dot" style="display:inline-block;width:10px;height:10px;background:green;border-radius:50%;"></div>' +
    '<span id="status-text">Online</span>' +
    '<div id="chat"></div>' +
    '<input type="text" id="prompt" placeholder="Napište zprávu...">' +
    '<button id="send-btn">Odeslat</button>' +
    '<button id="stop-btn" style="display:none;">Stop</button>' +
    '<button id="file-btn">Soubor</button>' +
    '<button id="clear-btn">Vymazat</button>' +
    '<button id="guardian-btn">Guardian</button>' +
    '<div id="guardian-alert" style="display:none;"></div>' +
    '<span id="guardian-alert-text"></span>' +
    '<div id="svedomi-loader" style="display:none;"></div>' +
    '<div id="undo-snackbar" style="display:none;"><span id="undo-text"></span><button id="undo-btn">Undo</button></div>' +
    '<script nonce="' + nonce + '">' +
    'console.log("SCRIPT START");' +
    'var vscode = acquireVsCodeApi();' +
    'var chat = document.getElementById("chat");' +
    'var prompt = document.getElementById("prompt");' +
    'var sendBtn = document.getElementById("send-btn");' +
    'var stopBtn = document.getElementById("stop-btn");' +
    'var statusDot = document.getElementById("status-dot");' +
    'var statusText = document.getElementById("status-text");' +
    'var busy = false;' +
    'var currentResponse = "";' +
    'function send() {' +
    '  if (busy) return;' +
    '  var text = prompt.value.trim();' +
    '  if (!text) return;' +
    '  prompt.value = "";' +
    '  addMessage(text, "user");' +
    '  addMessage("...", "assistant");' +
    '  busy = true;' +
    '  statusText.textContent = "Generuji...";' +
    '  statusDot.style.background = "orange";' +
    '  currentResponse = "";' +
    '  vscode.postMessage({ type: "chat", prompt: text });' +
    '}' +
    'function addMessage(text, role) {' +
    '  var div = document.createElement("div");' +
    '  div.className = "message " + role;' +
    '  div.textContent = text;' +
    '  chat.appendChild(div);' +
    '}' +
    'function updateLastAssistant(text) {' +
    '  var msgs = chat.querySelectorAll(".assistant");' +
    '  if (msgs.length > 0) msgs[msgs.length-1].textContent = text;' +
    '}' +
    'sendBtn.addEventListener("click", send);' +
    'prompt.addEventListener("keydown", function(e) { if (e.key === "Enter") send(); });' +
    'stopBtn.addEventListener("click", function() { vscode.postMessage({ type: "stop" }); });' +
    'document.getElementById("file-btn").addEventListener("click", function() { vscode.postMessage({ type: "requestActiveFile" }); });' +
    'document.getElementById("clear-btn").addEventListener("click", function() { if(confirm("Vymazat?")) vscode.postMessage({ type: "clearHistory" }); });' +
    'document.getElementById("guardian-btn").addEventListener("click", function() { vscode.postMessage({ type: "getGuardianStats" }); });' +
    'window.addEventListener("message", function(event) {' +
    '  var msg = event.data;' +
    '  if (msg.type === "responseChunk") {' +
    '    currentResponse += msg.text;' +
    '    updateLastAssistant(currentResponse);' +
    '  } else if (msg.type === "responseDone" || msg.type === "responseStopped" || msg.type === "responseError") {' +
    '    busy = false;' +
    '    statusText.textContent = "Online";' +
    '    statusDot.style.background = "green";' +
    '    if (msg.type === "responseError") updateLastAssistant("Chyba: " + msg.text);' +
    '  } else if (msg.type === "historyCleared") {' +
    '    chat.innerHTML = "";' +
    '  }' +
    '});' +
    'console.log("SCRIPT READY");' +
    'vscode.postMessage({ type: "debugLog", text: "Minimal webview loaded OK" });' +
    '</script>' +
    '</body>' +
    '</html>';
}

// ============================================================
// WEBVIEW CONTENT
// ============================================================

export function getWebviewContent(_webview: vscode.Webview, _initialMessages: ChatMessage[]): string {
  const nonce = getNonce();
  const safeModeEnabled = vscode.workspace.getConfiguration('shumilek').get<boolean>('toolsConfirmEdits', false);
  const sendWatchdogMs = Math.max(15000, resolveTimeoutMs(vscode.workspace.getConfiguration('shumilek')));
  
  // Build HTML using string concatenation to avoid template literal escaping issues
  let html = '<!DOCTYPE html>';
  html += '<html lang="cs">';
  html += '<head>';
  html += '<meta charset="UTF-8">';
  html += '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\';">';
  html += '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
  html += '<style>';
  html += ':root {';
  html += '  --bg-primary: #0a0f1a;';
  html += '  --bg-secondary: #111827;';
  html += '  --bg-tertiary: #1e293b;';
  html += '  --accent: #3b82f6;';
  html += '  --accent-hover: #2563eb;';
  html += '  --text-primary: #f1f5f9;';
  html += '  --text-secondary: #94a3b8;';
  html += '  --border: rgba(255,255,255,0.08);';
  html += '  --success: #10b981;';
  html += '  --warning: #f59e0b;';
  html += '  --error: #ef4444;';
  html += '  --guardian: #8b5cf6;';
  html += '}';
  html += '* { box-sizing: border-box; }';
  html += 'body {';
  html += '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;';
  html += '  margin: 0; padding: 0;';
  html += '  display: flex; flex-direction: column; height: 100vh;';
  html += '  background: var(--bg-primary); color: var(--text-primary);';
  html += '}';
  html += 'header {';
  html += '  display: flex; align-items: center; justify-content: space-between;';
  html += '  padding: 12px 16px; background: var(--bg-secondary);';
  html += '  border-bottom: 1px solid var(--border); flex-shrink: 0;';
  html += '}';
  html += '.brand { display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 15px; }';
  html += '.status-dot {';
  html += '  width: 8px; height: 8px; border-radius: 50%;';
  html += '  background: var(--success); box-shadow: 0 0 8px var(--success); transition: all 0.3s;';
  html += '}';
  html += '.status-dot.busy { background: var(--warning); box-shadow: 0 0 8px var(--warning); animation: pulse 1.2s infinite; }';
  html += '.status-dot.guardian { background: var(--guardian); box-shadow: 0 0 8px var(--guardian); }';
  html += '@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }';
  html += '.header-actions { display: flex; gap: 8px; }';
  html += '.icon-btn {';
  html += '  background: transparent; border: 1px solid var(--border);';
  html += '  color: var(--text-secondary); padding: 6px 10px; border-radius: 6px;';
  html += '  cursor: pointer; font-size: 12px; transition: all 0.2s;';
  html += '}';
  html += '.icon-btn:hover { background: var(--bg-tertiary); color: var(--text-primary); }';
  html += '.message-meta { display: flex; gap: 8px; align-items: center; justify-content: flex-end; font-size: 11px; color: var(--text-secondary); margin-bottom: 6px; }';
  html += '.message .message-content { position: relative; }';
  html += '.copy-message-btn { background: transparent; border: 1px solid rgba(255,255,255,0.06); color: var(--text-secondary); padding: 4px 8px; font-size: 11px; border-radius: 6px; cursor: pointer; }';
  html += '.copy-message-btn:hover { color: var(--text-primary); }';
  html += '.collapsible { transition: max-height 300ms ease, opacity 200ms ease; }';
  html += '.collapsible.collapsed { max-height: 220px; overflow: hidden; position: relative; }';
  html += '.show-more-btn { background: transparent; border: 1px solid rgba(255,255,255,0.06); color: var(--accent); padding: 4px 8px; font-size: 12px; border-radius: 6px; cursor: pointer; }';
  html += '#undo-snackbar { position: fixed; right: 20px; bottom: 20px; display: flex; gap: 8px; align-items: center; padding: 8px 12px; background: rgba(0,0,0,0.6); border-radius: 8px; border: 1px solid rgba(255,255,255,0.04); box-shadow: 0 6px 20px rgba(0,0,0,0.5); color: var(--text-primary); z-index: 60; opacity: 0; transform: translateY(10px); transition: opacity 200ms ease, transform 200ms ease; }';
  html += '#undo-snackbar.undo-show { opacity: 1; transform: translateY(0); }';
  html += '#undo-snackbar.undo-hidden { display: none; }';
  html += '#guardian-alert { position: fixed; top: 12px; right: 12px; display: none; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 10px; background: rgba(139, 92, 246, 0.12); color: var(--text-primary); border: 1px solid var(--guardian); box-shadow: 0 8px 30px rgba(0,0,0,0.35); transition: transform 300ms ease, opacity 300ms ease; transform-origin: top right; z-index: 80; }';
  html += '#guardian-alert.show { display: flex; animation: guardianPop 420ms ease; }';
  html += '@keyframes guardianPop { 0% { transform: scale(0.98); opacity: 0 } 60% { transform: scale(1.02); opacity: 1 } 100% { transform: scale(1); opacity: 1 } }';
  html += '#chat { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }';
  html += '.message { display: flex; flex-direction: column; max-width: 85%; animation: fadeIn 0.2s ease; }';
  html += '@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }';
  html += '.message.user { align-self: flex-end; }';
  html += '.message.assistant { align-self: flex-start; }';
  html += '.message-content { padding: 12px 16px; border-radius: 12px; font-size: 14px; line-height: 1.6; }';
  html += '.message.user .message-content { background: linear-gradient(135deg, #6366f1, #3b82f6); color: white; border-bottom-right-radius: 4px; }';
  html += '.message.assistant .message-content { background: var(--bg-tertiary); border: 1px solid var(--border); border-bottom-left-radius: 4px; }';
  
  // Pipeline status messages - hezky v chatu
  html += '.message.pipeline { align-self: center; max-width: 90%; }';
  html += '.message.pipeline .message-content { background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(59, 130, 246, 0.1)); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 12px; padding: 12px 16px; font-size: 13px; }';
  html += '.message.pipeline.planning .message-content { background: linear-gradient(135deg, rgba(234, 179, 8, 0.15), rgba(245, 158, 11, 0.1)); border-color: rgba(234, 179, 8, 0.4); }';
  html += '.message.pipeline.step .message-content { background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(99, 102, 241, 0.1)); border-color: rgba(59, 130, 246, 0.3); }';
  html += '.message.pipeline.review .message-content { background: linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(168, 85, 247, 0.1)); border-color: rgba(139, 92, 246, 0.3); }';
  html += '.message.pipeline.validation .message-content { background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(52, 211, 153, 0.1)); border-color: rgba(16, 185, 129, 0.3); }';
  html += '.message.pipeline.approved .message-content { background: linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(74, 222, 128, 0.1)); border-color: rgba(34, 197, 94, 0.4); }';
  html += '.message.pipeline.rejected .message-content { background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(248, 113, 113, 0.1)); border-color: rgba(239, 68, 68, 0.3); }';
  
  /* Unified Pipeline Log CSS */
  html += '.message.pipeline-log { width: 100%; max-width: 95%; align-self: center; margin: 4px 0; }';
  html += '.message.pipeline-log .message-content { background: rgba(30, 41, 59, 0.5); border: 1px solid rgba(255,255,255,0.1); padding: 0; overflow: hidden; display: flex; flex-direction: column; }';
  html += '.pipeline-header { padding: 10px 14px; background: rgba(255, 255, 255, 0.03); border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 600; color: var(--text-primary); }';
  html += '.pipeline-items { padding: 8px 14px; display: flex; flex-direction: column; gap: 6px; }';
  html += '.pipeline-item { display: flex; align-items: flex-start; gap: 10px; font-size: 12px; color: var(--text-secondary); line-height: 1.4; padding: 2px 0; }';
  html += '.pipeline-item .item-icon { flex-shrink: 0; width: 16px; text-align: center; opacity: 0.9; }';
  html += '.pipeline-item .item-text { flex: 1; word-break: break-word; }';
  html += '.pipeline-item.approved { color: var(--success); }';
  html += '.pipeline-item.rejected { color: var(--error); }';
  html += '.pipeline-item.step { color: var(--accent); }';
  
  html += '.pipeline-icon { font-size: 18px; margin-right: 8px; }';
  html += '.pipeline-text { display: inline; }';
  html += '.pipeline-progress { display: inline-block; margin-left: 8px; font-size: 11px; padding: 2px 8px; background: rgba(255,255,255,0.1); border-radius: 10px; color: var(--text-secondary); }';
  html += '.pipeline-spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.2); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 8px; vertical-align: middle; }';
  
  html += '.message-content p { margin: 0 0 8px 0; }';
  html += '.message-content p:last-child { margin-bottom: 0; }';
  html += '.message-content pre { margin: 12px 0; border-radius: 8px; overflow: hidden; background: #0d1117; border: 1px solid var(--border); position: relative; }';
  html += '.message-content pre code { display: block; padding: 12px; overflow-x: auto; font-family: "Fira Code", Consolas, monospace; font-size: 13px; line-height: 1.5; color: #e6edf3; }';
  html += '.copy-btn { position: absolute; top: 8px; right: 8px; background: rgba(255,255,255,0.1); border: none; color: var(--text-secondary); padding: 4px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; opacity: 0; transition: opacity 0.2s; }';
  html += '.message-content pre:hover .copy-btn { opacity: 1; }';
  html += '.copy-btn:hover { background: rgba(255,255,255,0.2); color: white; }';
  html += '.message-content code { font-family: "Fira Code", Consolas, monospace; background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }';
  html += '.message-content ul, .message-content ol { margin: 8px 0; padding-left: 20px; }';
  html += '.message-content blockquote { margin: 8px 0; padding-left: 12px; border-left: 3px solid var(--accent); color: var(--text-secondary); }';
  html += '.message-content a { color: #60a5fa; text-decoration: none; }';
  html += '.message-content a:hover { text-decoration: underline; }';
  html += '.typing-indicator { display: flex; gap: 4px; padding: 8px 0; }';
  html += '.typing-indicator span { width: 8px; height: 8px; background: var(--text-secondary); border-radius: 50%; animation: bounce 1.4s infinite; }';
  html += '.typing-indicator span:nth-child(2) { animation-delay: 0.2s; }';
  html += '.typing-indicator span:nth-child(3) { animation-delay: 0.4s; }';
  html += '@keyframes bounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-8px); } }';
  html += '.svedomi-loader { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 12px; padding: 24px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4); z-index: 1000; text-align: center; min-width: 280px; }';
  html += '.svedomi-loader.active { display: flex; flex-direction: column; align-items: center; gap: 16px; }';
  html += '.svedomi-spinner { width: 48px; height: 48px; border: 3px solid rgba(59, 130, 246, 0.2); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }';
  html += '@keyframes spin { to { transform: rotate(360deg); } }';
  html += '.svedomi-text { font-size: 14px; color: var(--text-secondary); font-weight: 500; }';
  html += '#input-area { padding: 16px; background: var(--bg-secondary); border-top: 1px solid var(--border); flex-shrink: 0; }';
  html += '#input-container { display: flex; align-items: flex-end; gap: 8px; background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: 12px; padding: 8px 12px; transition: border-color 0.2s, box-shadow 0.2s; }';
  html += '#input-container:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15); }';
  html += '#prompt { flex: 1; border: none; background: transparent; color: var(--text-primary); font-family: inherit; font-size: 14px; line-height: 1.5; resize: none; min-height: 24px; max-height: 150px; padding: 4px 0; outline: none; }';
  html += '#prompt::placeholder { color: var(--text-secondary); }';
  html += '.action-btn { background: var(--accent); border: none; color: white; width: 36px; height: 36px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; flex-shrink: 0; }';
  html += '.action-btn:hover { background: var(--accent-hover); transform: scale(1.05); }';
  html += '.action-btn:disabled { background: #475569; cursor: not-allowed; transform: none; }';
  html += '.action-btn.stop { background: var(--error); }';
  html += '.action-btn.stop:hover { background: #dc2626; }';
  html += '#toolbar { display: flex; gap: 8px; margin-top: 10px; }';
  html += '.toolbar-btn { display: flex; align-items: center; gap: 6px; background: transparent; border: 1px solid var(--border); color: var(--text-secondary); padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; transition: all 0.2s; }';
  html += '.toolbar-btn:hover { background: var(--bg-tertiary); color: var(--text-primary); border-color: var(--text-secondary); }';
  html += '.toolbar-btn:disabled { opacity: 0.5; cursor: not-allowed; }';
  html += '.toolbar-btn.active { background: rgba(59, 130, 246, 0.15); border-color: var(--accent); color: var(--text-primary); }';
  html += '.tools-status { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; font-size: 11px; }';
  html += '.tools-pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-secondary); }';
  html += '.tools-pill.on { color: var(--accent); border-color: rgba(59, 130, 246, 0.45); }';
  html += '.tools-pill.warn { color: var(--warning); border-color: rgba(245, 158, 11, 0.6); }';
  html += '.tools-toast { margin-top: 6px; padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(59, 130, 246, 0.35); background: rgba(59, 130, 246, 0.12); color: var(--text-primary); font-size: 12px; display: none; }';
  html += '::-webkit-scrollbar { width: 6px; }';
  html += '::-webkit-scrollbar-track { background: transparent; }';
  html += '::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }';
  html += '::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }';
  html += '.welcome { text-align: center; padding: 40px 20px; color: var(--text-secondary); }';
  html += '.welcome h2 { color: var(--text-primary); margin: 0 0 8px 0; font-size: 20px; }';
  html += '.welcome p { margin: 0 0 16px 0; font-size: 14px; }';
  html += '.guardian-badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(139, 92, 246, 0.15); color: var(--guardian); padding: 6px 12px; border-radius: 20px; font-size: 12px; }';
  html += '</style>';
  html += '</head>';
  html += '<body>';
  
  // Header
  html += '<header>';
  html += '<div class="brand">';
  html += '<div class="status-dot" id="status-dot"></div>';
  html += '<span>Šumílek AI</span>';
  html += '<span id="status-text" style="font-size: 12px; color: var(--text-secondary)">Online</span>';
  html += '</div>';
  html += '<div class="header-actions">';
  html += '<button class="icon-btn" id="regenerate-btn" title="Regenerovat poslední odpověď">&#128257;</button>';
  html += '<button class="icon-btn" id="copyall-btn" title="Zkopírovat všechny AI odpovědi">&#128203;</button>';
  html += '<button class="icon-btn guardian" id="guardian-btn" title="Guardian Stats">&#128737;</button>';
  html += '<button class="icon-btn" id="clear-btn" title="Vymazat historii">&#128465;</button>';
  html += '</div>';
  html += '</header>';
  
  // Guardian alert - hidden (replaced by pipeline status in chat)
  html += '<div id="guardian-alert" style="display:none !important;"><span>&#128737;</span><span id="guardian-alert-text"></span></div>';
  html += '<div id="undo-snackbar" class="undo-hidden"><span id="undo-text">Historie byla vymazána</span><button id="undo-btn" class="icon-btn">Vrátit</button></div>';
  html += '<div id="chat"></div>';
  
  // Input area
  html += '<div id="input-area">';
  html += '<div id="input-container">';
  html += '<textarea id="prompt" placeholder="Zeptej se na cokoliv..." rows="1"></textarea>';
  html += '<button class="action-btn" id="send-btn" title="Odeslat (Ctrl+Enter)">';
  html += '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
  html += '</button>';
  html += '<button class="action-btn stop" id="stop-btn" style="display: none" title="Zastavit">';
  html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>';
  html += '</button>';
  html += '</div>';
  html += '<div class="svedomi-loader" id="svedomi-loader"><div class="svedomi-spinner"></div><div class="svedomi-text">Načítám svedomi...</div></div>';
  html += '<div id="toolbar">';
  html += '<button class="toolbar-btn" id="file-btn">';
  html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>';
  html += 'Přidat soubor';
  html += '</button>';
  html += '<button class="toolbar-btn" id="safe-mode-btn" title="Přepnout potvrzování změn"></button>';
  html += '</div>';
  html += '<div id="tools-status" class="tools-status">';
  html += '<span class="tools-pill" id="tools-status-tools"></span>';
  html += '<span class="tools-pill" id="tools-status-confirm"></span>';
  html += '<span class="tools-pill" id="tools-status-lasttool"></span>';
  html += '<span class="tools-pill" id="tools-status-lastwrite"></span>';
  html += '</div>';
  html += '<div id="tools-toast" class="tools-toast"></div>';
  html += '</div>';
  
  // Script - using string concatenation to avoid escaping nightmares
  html += '<script nonce="' + nonce + '">';
  html += 'console.log("SHUMILEK BOOT");';
  html += 'var vscode = acquireVsCodeApi();';
  html += 'function debugLog(t) { try { vscode.postMessage({ type: "debugLog", text: String(t) }); } catch(e) {} }';
  html += 'window.addEventListener("error", function(e) { debugLog("JS error: " + (e.error ? e.error.stack : e.message)); });';
  html += 'window.addEventListener("unhandledrejection", function(e) { debugLog("Unhandled rejection: " + (e.reason ? e.reason.stack || e.reason.message : e.reason)); });';
  html += 'debugLog("Webview script start");';
  
  html += 'var chat = document.getElementById("chat");';
  html += 'var prompt = document.getElementById("prompt");';
  html += 'var sendBtn = document.getElementById("send-btn");';
  html += 'var stopBtn = document.getElementById("stop-btn");';
  html += 'var fileBtn = document.getElementById("file-btn");';
  html += 'var safeModeBtn = document.getElementById("safe-mode-btn");';
  html += 'var clearBtn = document.getElementById("clear-btn");';
  html += 'var guardianBtn = document.getElementById("guardian-btn");';
  html += 'var toolsStatusTools = document.getElementById("tools-status-tools");';
  html += 'var toolsStatusConfirm = document.getElementById("tools-status-confirm");';
  html += 'var toolsStatusLastTool = document.getElementById("tools-status-lasttool");';
  html += 'var toolsStatusLastWrite = document.getElementById("tools-status-lastwrite");';
  html += 'var toolsToast = document.getElementById("tools-toast");';
  html += 'var statusDot = document.getElementById("status-dot");';
  html += 'var statusText = document.getElementById("status-text");';
  html += 'var guardianAlert = document.getElementById("guardian-alert");';
  html += 'var guardianAlertText = document.getElementById("guardian-alert-text");';
  html += 'var svedomiLoader = document.getElementById("svedomi-loader");';
  html += 'var undoSnackbar = document.getElementById("undo-snackbar");';
  html += 'var undoText = document.getElementById("undo-text");';
  html += 'var undoBtn = document.getElementById("undo-btn");';
  html += 'var regenerateBtn = document.getElementById("regenerate-btn");';
  html += 'var copyAllBtn = document.getElementById("copyall-btn");';
  
  html += 'var busy = false;';
  html += 'var currentResponse = "";';
  html += 'var messages = [];';
  html += 'var undoTimer = null;';
  html += 'var guardianAlertTimer = null;';
  html += 'var sendWatchdogTimer = null;';
  html += 'var lastResponseActivityAt = 0;';
  html += 'var safeMode = ' + (safeModeEnabled ? 'true' : 'false') + ';';
  html += 'var toolsEnabled = ' + (getToolsEnabledSetting() ? 'true' : 'false') + ';';
  html += 'var lastToolName = "";';
  html += 'var lastWriteLabel = "";';
  html += 'var toolsToastTimer = null;';
  html += 'var sendWatchdogMs = ' + sendWatchdogMs + ';';
  
  // Helper functions
  html += 'function clearSendWatchdog() { if (sendWatchdogTimer) { clearTimeout(sendWatchdogTimer); sendWatchdogTimer = null; } }';
  html += 'function armSendWatchdog(ms) {';
  html += '  clearSendWatchdog();';
  html += '  sendWatchdogTimer = setTimeout(function() {';
  html += '    if (busy && Date.now() - lastResponseActivityAt >= ms) {';
  html += '      var lastMsg = chat.querySelector(".message.assistant:last-child");';
  html += '      var typing = lastMsg ? lastMsg.querySelector(".typing-indicator") : null;';
  html += '      if (lastMsg && typing && !currentResponse) lastMsg.remove();';
  html += '      clearPipelineMessages();';
  html += '      setBusy(false);';
  html += '      showGuardianAlert("Odezva nedorazila (casovy limit). Zkus to znovu.", 6000);';
  html += '    }';
  html += '  }, ms);';
  html += '}';
  
  html += 'function showUndoSnackbar(text, duration) {';
  html += '  undoText.textContent = text || "Historie byla vymazána";';
  html += '  undoSnackbar.classList.remove("undo-hidden");';
  html += '  undoSnackbar.classList.add("undo-show");';
  html += '  if (undoTimer) clearTimeout(undoTimer);';
  html += '  undoTimer = setTimeout(hideUndoSnackbar, duration || 8000);';
  html += '}';
  html += 'function hideUndoSnackbar() { if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; } undoSnackbar.classList.remove("undo-show"); undoSnackbar.classList.add("undo-hidden"); }';
  
  html += 'function showSvedomiLoader() { svedomiLoader.classList.add("active"); }';
  html += 'function hideSvedomiLoader() { svedomiLoader.classList.remove("active"); }';
  html += 'function updateToolsStatus() {';
  html += '  if (!toolsStatusTools || !toolsStatusConfirm || !toolsStatusLastTool || !toolsStatusLastWrite) return;';
  html += '  toolsStatusTools.textContent = toolsEnabled ? "Nástroje: zapnuté" : "Nástroje: vypnuté";';
  html += '  toolsStatusTools.className = "tools-pill" + (toolsEnabled ? " on" : " warn");';
  html += '  toolsStatusConfirm.textContent = safeMode ? "Potvrzování: zapnuto" : "Potvrzování: vypnuto";';
  html += '  toolsStatusConfirm.className = "tools-pill" + (safeMode ? " warn" : " on");';
  html += '  toolsStatusLastTool.textContent = "Poslední nástroj: " + (lastToolName || "—");';
  html += '  toolsStatusLastWrite.textContent = "Poslední zápis: " + (lastWriteLabel || "—");';
  html += '}';
  html += 'function showToolsToast(text) {';
  html += '  if (!toolsToast) return;';
  html += '  toolsToast.textContent = text;';
  html += '  toolsToast.style.display = "block";';
  html += '  if (toolsToastTimer) clearTimeout(toolsToastTimer);';
  html += '  toolsToastTimer = setTimeout(function() { toolsToast.style.display = "none"; }, 4000);';
  html += '}';
  
  // Legacy showGuardianAlert - redirect to pipeline status in chat
  html += 'function showGuardianAlert(message, duration) {';
  html += '  addPipelineStatus("🛡️", message, "validation", null, false);';
  html += '}';
  
  html += 'function setBusy(state) {';
  html += '  busy = state;';
  html += '  sendBtn.style.display = state ? "none" : "flex";';
  html += '  stopBtn.style.display = state ? "flex" : "none";';
  html += '  fileBtn.disabled = state;';
  html += '  prompt.disabled = state;';
  html += '  if (state) { statusDot.classList.add("busy"); statusText.textContent = "Generuji..."; }';
  html += '  else { statusDot.classList.remove("busy"); statusDot.classList.remove("guardian"); statusText.textContent = "Online"; }';
  html += '}';
  
  html += 'function scrollToBottom() { chat.scrollTop = chat.scrollHeight; }';
  
  html += 'function formatTime(ts) { if (!ts) return ""; var d = new Date(ts); return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }';
  
  // Markdown parser - simplified but safe
  html += 'function parseMarkdown(text) {';
  html += '  if (!text || typeof text !== "string") return "";';
  html += '  if (text.length > 100000) text = text.slice(0, 100000) + "\\n\\n[Obsah zkrácen]";';
  html += '  var html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");';
  html += '  var tick = String.fromCharCode(96);';
  html += '  var cbRe = new RegExp(tick + tick + tick + "(\\\\w*)?\\\\n([\\\\s\\\\S]*?)" + tick + tick + tick, "g");';
  html += '  html = html.replace(cbRe, function(m, lang, code) { return "<pre><code class=\\"language-" + (lang || "text") + "\\">" + code.trim() + "</code></pre>"; });';
  html += '  var icRe = new RegExp(tick + "([^" + tick + "]+)" + tick, "g");';
  html += '  html = html.replace(icRe, "<code>$1</code>");';
  html += '  html = html.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");';
  html += '  html = html.replace(/\\*([^*]+)\\*/g, "<em>$1</em>");';
  html += '  html = html.replace(/\\n/g, "<br>");';
  html += '  return html;';
  html += '}';
  
  html += 'function addCopyButtons(container) {';
  html += '  container.querySelectorAll("pre").forEach(function(pre) {';
  html += '    if (pre.querySelector(".copy-btn")) return;';
  html += '    var btn = document.createElement("button");';
  html += '    btn.className = "copy-btn";';
  html += '    btn.textContent = "Kopírovat";';
  html += '    btn.onclick = function() {';
  html += '      var code = pre.querySelector("code");';
  html += '      navigator.clipboard.writeText(code ? code.textContent : "").then(function() {';
  html += '        btn.textContent = "OK!";';
  html += '        setTimeout(function() { btn.textContent = "Kopírovat"; }, 2000);';
  html += '      });';
  html += '    };';
  html += '    pre.appendChild(btn);';
  html += '  });';
  html += '}';
  
  // Render welcome or messages
  html += 'function renderMessages() {';
  html += '  if (messages.length === 0) {';
  html += '    chat.innerHTML = \'<div class="welcome"><h2>Ahoj!</h2><p>Jsem Sumilek, tvuj AI asistent pro kodovani.</p><div class="guardian-badge">Guardian + Svedomi aktivni</div></div>\';';
  html += '    return;';
  html += '  }';
  html += '  chat.innerHTML = "";';
  html += '  messages.forEach(function(msg) { if (msg.role !== "system") addMessageToUI(msg.content, msg.role, false, msg.timestamp || Date.now()); });';
  html += '  scrollToBottom();';
  html += '}';
  
  html += 'function addMessageToUI(content, role, isStreaming, ts) {';
  html += '  var msgEl = document.createElement("div");';
  html += '  msgEl.className = "message " + role;';
  html += '  var meta = document.createElement("div");';
  html += '  meta.className = "message-meta";';
  html += '  var timeSpan = document.createElement("span");';
  html += '  timeSpan.textContent = formatTime(ts || Date.now());';
  html += '  meta.appendChild(timeSpan);';
  html += '  var contentEl = document.createElement("div");';
  html += '  contentEl.className = "message-content";';
  html += '  if (role === "assistant") {';
  html += '    contentEl.innerHTML = isStreaming && !content ? \'<div class="typing-indicator"><span></span><span></span><span></span></div>\' : parseMarkdown(content);';
  html += '    addCopyButtons(contentEl);';
  html += '    var copyBtn = document.createElement("button");';
  html += '    copyBtn.className = "copy-message-btn";';
  html += '    copyBtn.textContent = "Kopírovat";';
  html += '    copyBtn.onclick = function() { navigator.clipboard.writeText(contentEl.textContent || ""); copyBtn.textContent = "OK!"; setTimeout(function() { copyBtn.textContent = "Kopírovat"; }, 1500); };';
  html += '    meta.appendChild(copyBtn);';
  html += '  } else {';
  html += '    var escaped = content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");';
  html += '    contentEl.innerHTML = escaped.replace(/\\n/g, "<br>");';
  html += '  }';
  html += '  msgEl.appendChild(meta);';
  html += '  var wrapper = document.createElement("div");';
  html += '  wrapper.className = "collapsible";';
  html += '  wrapper.appendChild(contentEl);';
  html += '  msgEl.appendChild(wrapper);';
  html += '  chat.appendChild(msgEl);';
  html += '  scrollToBottom();';
  html += '  return contentEl;';
  html += '}';
  
  // Pipeline status in chat - Unified Log implementation
  html += 'var currentPipelineLog = null;';
  
  html += 'function escHtml(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }';
  
  html += 'function getOrCreatePipelineLog() {';
  html += '    if (currentPipelineLog) return currentPipelineLog;';
  html += '    var msgEl = document.createElement("div");';
  html += '    msgEl.className = "message pipeline-log";';
  html += '    var contentEl = document.createElement("div");';
  html += '    contentEl.className = "message-content";';
  html += '    contentEl.innerHTML = \'<div class="pipeline-header"><span class="pipeline-spinner"></span><span class="pipeline-text">Zpracovávám...</span></div><div class="pipeline-items"></div>\';';
  html += '    msgEl.appendChild(contentEl);';
  html += '    chat.appendChild(msgEl);';
  html += '    currentPipelineLog = msgEl;';
  html += '    scrollToBottom();';
  html += '    return msgEl;';
  html += '}';

  html += 'function updatePipelineHeader(icon, text, isLoading) {';
  html += '    var log = getOrCreatePipelineLog();';
  html += '    var header = log.querySelector(".pipeline-header");';
  html += '    var spinnerHtml = isLoading ? \'<span class="pipeline-spinner"></span>\' : (icon ? \'<span class="pipeline-icon" style="margin-right:8px">\' + icon + \'</span>\' : \'\');';
  html += '    header.innerHTML = spinnerHtml + \'<span class="pipeline-text">\' + escHtml(text) + \'</span>\';';
  html += '}';

  html += 'function addPipelineItem(icon, text, type) {';
  html += '    var log = getOrCreatePipelineLog();';
  html += '    var items = log.querySelector(".pipeline-items");';
  html += '    var item = document.createElement("div");';
  html += '    item.className = "pipeline-item " + (type || "");';
  html += '    item.innerHTML = \'<span class="item-icon">\' + escHtml(icon) + \'</span><span class="item-text">\' + escHtml(text) + \'</span>\';';
  html += '    items.appendChild(item);';
  html += '    scrollToBottom();';
  html += '}';
  
  html += 'function addPipelineStatus(icon, text, type, progress, isLoading) {';
  html += '  if (isLoading) { updatePipelineHeader(icon, text, true); }';
  html += '  else { addPipelineItem(icon, text, type); }';
  html += '  return currentPipelineLog;';
  html += '}';
  
  html += 'function updatePipelineStatus(icon, text, type) {';
  html += '  var log = getOrCreatePipelineLog();';
  html += '  var items = log.querySelector(".pipeline-items");';
  html += '  if (items.lastChild) {';
  html += '      items.lastChild.innerHTML = \'<span class="item-icon">\' + escHtml(icon) + \'</span><span class="item-text">\' + escHtml(text) + \'</span>\';';
  html += '      items.lastChild.className = "pipeline-item " + (type || "");';
  html += '  } else { addPipelineItem(icon, text, type); }';
  html += '}';
  
  html += 'function clearPipelineMessages() {';
  html += '  if (currentPipelineLog) {';
  html += '      var header = currentPipelineLog.querySelector(".pipeline-header");';
  html += '      if (header && header.querySelector(".pipeline-spinner")) {';
  html += '          header.innerHTML = \'<span class="pipeline-icon" style="margin-right:8px">✅</span><span class="pipeline-text">Hotovo</span>\';';
  html += '      }';
  html += '      currentPipelineLog = null;';
  html += '  }';
  html += '}';

  html += 'function updateLastAssistantMessage(content) {';
  html += '  var assistantMsgs = chat.querySelectorAll(".message.assistant:not(.pipeline)");';
  html += '  var lastMsg = assistantMsgs.length > 0 ? assistantMsgs[assistantMsgs.length - 1].querySelector(".message-content") : null;';
  html += '  if (lastMsg) { lastMsg.innerHTML = parseMarkdown(content); addCopyButtons(lastMsg); scrollToBottom(); }';
  html += '}';
  
  html += 'function updateSafeModeButton() {';
  html += '  if (!safeModeBtn) return;';
  html += '  safeModeBtn.textContent = safeMode ? "Potvrzování: zapnuto" : "Potvrzování: vypnuto";';
  html += '  if (safeMode) safeModeBtn.classList.add("active"); else safeModeBtn.classList.remove("active");';
  html += '  updateToolsStatus();';
  html += '}';
  
  // Send / stop functions
  html += 'function send() {';
  html += '  if (busy) { addPipelineStatus("⏳", "Ještě generuji. Chvíli počkej.", "validation", null, false); return; }';
  html += '  var text = prompt.value.trim();';
  html += '  if (!text) return;';
  html += '  prompt.value = "";';
  html += '  prompt.style.height = "auto";';
  html += '  addMessageToUI(text, "user", false, Date.now());';
  html += '  addMessageToUI("", "assistant", true, Date.now());';
  html += '  setBusy(true);';
  html += '  currentResponse = "";';
  html += '  lastResponseActivityAt = Date.now();';
  html += '  armSendWatchdog(sendWatchdogMs);';
  html += '  vscode.postMessage({ type: "chat", prompt: text });';
  html += '}';
  
  html += 'function stop() {';
  html += '  clearSendWatchdog();';
  html += '  if (busy) setBusy(false);';
  html += '  vscode.postMessage({ type: "stop" });';
  html += '}';
  
  html += 'function clearHistory() {';
  html += '  if (confirm("Opravdu chceš vymazat celou historii?")) vscode.postMessage({ type: "clearHistory" });';
  html += '}';
  
  html += 'function regenerateLast() {';
  html += '  if (busy) return;';
  html += '  if (!messages || messages.length === 0) { showGuardianAlert("Žádný předchozí dotaz", 3000); return; }';
  html += '  for (var i = messages.length - 1; i >= 0; i--) {';
  html += '    if (messages[i] && messages[i].role === "user") {';
  html += '      var promptText = messages[i].content;';
  html += '      addMessageToUI(promptText, "user", false, Date.now());';
  html += '      addMessageToUI("", "assistant", true, Date.now());';
  html += '      currentResponse = "";';
  html += '      setBusy(true);';
  html += '      vscode.postMessage({ type: "chat", prompt: promptText });';
  html += '      return;';
  html += '    }';
  html += '  }';
  html += '  showGuardianAlert("Žádný předchozí dotaz", 3000);';
  html += '}';
  
  html += 'function copyAllAssistantMessages() {';
  html += '  var nodes = document.querySelectorAll(".message.assistant .message-content");';
  html += '  var texts = [];';
  html += '  nodes.forEach(function(n) { if (n.textContent) texts.push(n.textContent); });';
  html += '  if (texts.length === 0) { showGuardianAlert("Žádné odpovědi", 2500); return; }';
  html += '  navigator.clipboard.writeText(texts.join("\\n\\n")).then(function() { showGuardianAlert("Zkopírováno!", 2000); });';
  html += '}';
  
  html += 'function showGuardianStatsModal(stats) {';
  html += '  var existing = document.getElementById("guardian-stats-modal");';
  html += '  if (existing) existing.remove();';
  html += '  var modal = document.createElement("div");';
  html += '  modal.id = "guardian-stats-modal";';
  html += '  modal.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:1000;";';
  html += '  modal.innerHTML = \'<div style="background:var(--bg-secondary);border-radius:12px;padding:24px;max-width:400px;width:90%;border:1px solid var(--border);">\' +';
  html += '    \'<h3 style="margin:0 0 16px 0;color:var(--guardian);">Guardian Statistiky</h3>\' +';
  html += '    \'<div style="font-size:14px;">Kontrol: \' + stats.totalChecks + \'<br>Smyčky: \' + stats.loopsDetected + \'<br>Opakování: \' + stats.repetitionsFixed + \'<br>Retries: \' + stats.retriesTriggered + \'</div>\' +';
  html += '    \'<h4 style="margin:16px 0 8px 0;color:var(--accent);">Svedomi</h4>\' +';
  html += '    \'<div style="font-size:14px;">Validace: \' + stats.miniModelValidations + \'<br>Zamitnuti: \' + stats.miniModelRejections + \'</div>\' +';
  html += '    \'<button id="close-stats-modal" style="margin-top:16px;width:100%;padding:10px;background:var(--accent);border:none;border-radius:8px;color:white;cursor:pointer;">Zavřít</button>\' +';
  html += '    \'</div>\';';
  html += '  document.body.appendChild(modal);';
  html += '  modal.onclick = function(e) { if (e.target === modal) modal.remove(); };';
  html += '  document.getElementById("close-stats-modal").onclick = function() { modal.remove(); };';
  html += '}';
  
  // Event listeners
  html += 'prompt.addEventListener("input", function() { prompt.style.height = "auto"; prompt.style.height = Math.min(prompt.scrollHeight, 150) + "px"; });';
  html += 'prompt.addEventListener("keydown", function(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });';
  html += 'sendBtn.addEventListener("click", function() { debugLog("Send click"); send(); });';
  html += 'stopBtn.addEventListener("click", function() { debugLog("Stop click"); stop(); });';
  html += 'fileBtn.addEventListener("click", function() { debugLog("File click"); vscode.postMessage({ type: "requestActiveFile" }); });';
  html += 'if (safeModeBtn) safeModeBtn.addEventListener("click", function() { debugLog("Safe mode toggle"); vscode.postMessage({ type: "toggleSafeMode" }); });';
  html += 'clearBtn.addEventListener("click", function() { debugLog("Clear click"); clearHistory(); });';
  html += 'guardianBtn.addEventListener("click", function() { debugLog("Guardian click"); vscode.postMessage({ type: "getGuardianStats" }); });';
  html += 'if (regenerateBtn) regenerateBtn.addEventListener("click", function() { debugLog("Regenerate click"); regenerateLast(); });';
  html += 'if (copyAllBtn) copyAllBtn.addEventListener("click", function() { debugLog("CopyAll click"); copyAllAssistantMessages(); });';
  html += 'if (undoBtn) undoBtn.addEventListener("click", function() { vscode.postMessage({ type: "restoreHistory" }); hideUndoSnackbar(); });';
  
  // Message handler
  html += 'window.addEventListener("message", function(event) {';
  html += '  var msg = event.data;';
  html += '  switch (msg.type) {';
  html += '    case "responseChunk":';
  html += '      currentResponse += msg.text;';
  html += '      updateLastAssistantMessage(currentResponse);';
  html += '      lastResponseActivityAt = Date.now();';
  html += '      armSendWatchdog(sendWatchdogMs);';
  html += '      break;';
  html += '    case "responseDone":';
  html += '      clearSendWatchdog();';
  html += '      clearPipelineMessages();';
  html += '      setBusy(false);';
  html += '      break;';
  html += '    case "responseStopped":';
  html += '      clearSendWatchdog();';
  html += '      clearPipelineMessages();';
  html += '      if (currentResponse) { currentResponse += "\\n\\n[Zastaveno]"; updateLastAssistantMessage(currentResponse); }';
  html += '      setBusy(false);';
  html += '      break;';
  html += '    case "responseError":';
  html += '      clearSendWatchdog();';
  html += '      clearPipelineMessages();';
  html += '      var assistantMsgsErr = chat.querySelectorAll(".message.assistant:not(.pipeline)");';
  html += '      if (assistantMsgsErr.length > 0) assistantMsgsErr[assistantMsgsErr.length - 1].remove();';
  html += '      addMessageToUI("Chyba: " + String(msg.text || "Neznama chyba"), "assistant", false, Date.now());';
  html += '      setBusy(false);';
  html += '      break;';
  html += '    case "activeFileContent":';
  html += '      if (msg.text) {';
  html += '        var fileText = msg.text.length > 50000 ? msg.text.slice(0, 50000) + "\\n[Zkraceno]" : msg.text;';
  html += '        var fileName = String(msg.fileName || "soubor").replace(/[<>"]/g, "");';
  html += '        var tick = String.fromCharCode(96);';
  html += '        prompt.value = prompt.value + (prompt.value ? "\\n\\n" : "") + "Soubor " + fileName + ":\\n" + tick + tick + tick + "\\n" + fileText + "\\n" + tick + tick + tick;';
  html += '        prompt.dispatchEvent(new Event("input"));';
  html += '        prompt.focus();';
  html += '      } else { alert("Žádný aktivní soubor"); }';
  html += '      break;';
  html += '    case "historyCleared":';
  html += '      messages = [];';
  html += '      renderMessages();';
  html += '      showUndoSnackbar("Historie vymazána – chceš ji vrátit?", 8000);';
  html += '      break;';
  html += '    case "historyRestored":';
  html += '      messages = msg.messages || [];';
  html += '      renderMessages();';
  html += '      addPipelineStatus("✅", "Historie obnovena", "approved", null, false);';
  html += '      break;';
  html += '    case "historyRestoreFailed":';
  html += '      addPipelineStatus("❌", "Obnoveni selhalo", "rejected", null, false);';
  html += '      break;';
  // Pipeline events - zobrazeni v chatu
  html += '    case "rozumPlanning":';
  html += '      addPipelineStatus("🧠", "Rozum planuje postup...", "planning", null, true);';
  html += '      break;';
  html += '    case "rozumPlanReady":';
  html += '      if (msg.plan) {';
  html += '        updatePipelineStatus("📋", "Plan: " + msg.plan.totalSteps + " kroku (" + msg.plan.complexity + ")", "planning");';
  html += '      }';
  html += '      break;';
  html += '    case "stepStart":';
  html += '      if (msg.step) {';
  html += '        addPipelineStatus(msg.step.emoji || "📦", msg.step.title, "step", "Krok " + msg.step.current + "/" + msg.step.total, true);';
  html += '      }';
  html += '      break;';
  html += '    case "stepComplete":';
  html += '      if (msg.step) {';
  html += '        updatePipelineStatus(msg.step.emoji || "✓", msg.step.title + " - hotovo", "step");';
  html += '      }';
  html += '      break;';
  html += '    case "stepReview":';
  html += '      if (msg.step) {';
  html += '        var reviewIcon = msg.approved ? "✅" : "🔄";';
  html += '        var reviewText = msg.approved ? "Rozum schválil" : "Rozum: " + (msg.feedback || "opakuji");';
  html += '        addPipelineStatus(reviewIcon, reviewText, msg.approved ? "approved" : "review", null, false);';
  html += '      }';
  html += '      break;';
  html += '    case "stepSvedomi":';
  html += '      if (msg.result) {';
  html += '        var svedIcon = msg.result.score >= 5 ? "✅" : "⚠️";';
  html += '        addPipelineStatus(svedIcon, "Svedomi: " + msg.result.score + "/10", msg.result.score >= 5 ? "approved" : "rejected", null, false);';
  html += '      }';
  html += '      break;';
  html += '    case "pipelineStatus":';
  html += '      addPipelineStatus(msg.icon || "ℹ️", msg.text, msg.statusType || "", msg.progress || null, msg.loading || false);';
  html += '      lastResponseActivityAt = Date.now();';
  html += '      armSendWatchdog(sendWatchdogMs);';
  html += '      break;';
  html += '    case "pipelineApproved":';
  html += '      clearPipelineMessages();';
  html += '      clearSendWatchdog();';
  html += '      setBusy(false);';
  html += '      addPipelineStatus("✅", "Odpověď schválena!", "approved", null, false);';
  html += '      break;';
  html += '    case "guardianAlert":';
  html += '      addPipelineStatus("🛡️", msg.message, "validation", null, false);';
  html += '      break;';
  html += '    case "svedomiValidating":';
  html += '      addPipelineStatus("🧠", "Svedomi validuje...", "validation", null, true);';
  html += '      break;';
  html += '    case "svedomiValidationDone":';
  html += '      break;';
  html += '    case "guardianStatus":';
  html += '      if (!msg.result.isOk) {';
  html += '        statusDot.classList.add("guardian");';
  html += '        addPipelineStatus("🛡️", "Guardian: " + (msg.result.issues ? msg.result.issues.join(", ") : "Problem"), "rejected", null, false);';
  html += '      }';
  html += '      break;';
  html += '    case "miniModelResult":';
  html += '      if (msg.result) addPipelineStatus("📊", "Skóre: " + msg.result.score + "/10 - " + msg.result.reason, msg.result.score >= 5 ? "approved" : "rejected", null, false);';
  html += '      break;';
  html += '    case "guardianStats":';
  html += '      showGuardianStatsModal(msg.stats);';
  html += '      break;';
  html += '    case "toolsStatus":';
  html += '      if (typeof msg.toolsEnabled === "boolean") toolsEnabled = msg.toolsEnabled;';
  html += '      if (typeof msg.confirmEdits === "boolean") safeMode = msg.confirmEdits;';
  html += '      updateSafeModeButton();';
  html += '      updateToolsStatus();';
  html += '      break;';
  html += '    case "toolEvent":';
  html += '      if (msg.name) { lastToolName = msg.name; updateToolsStatus(); }';
  html += '      lastResponseActivityAt = Date.now();';
  html += '      armSendWatchdog(sendWatchdogMs);';
  html += '      break;';
  html += '    case "toolWrite":';
  html += '      if (msg.path) {';
  html += '        lastWriteLabel = msg.path;';
  html += '        updateToolsStatus();';
  html += '        lastResponseActivityAt = Date.now();';
  html += '        armSendWatchdog(sendWatchdogMs);';
  html += '        var verb = msg.action === "created" ? "Soubor vytvořen" : "Soubor upraven";';
  html += '        showToolsToast(verb + ": " + msg.path);';
  html += '      }';
  html += '      break;';
  html += '    case "safeModeUpdated":';
  html += '      safeMode = !!msg.enabled;';
  html += '      updateSafeModeButton();';
  html += '      break;';
  html += '  }';
  html += '});';
  
  html += 'updateSafeModeButton();';
  html += 'updateToolsStatus();';
  html += 'renderMessages();';
  html += 'debugLog("Full webview script ready");';
  html += '</script>';
  html += '</body>';
  html += '</html>';
  
  return html;
}
