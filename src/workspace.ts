// WorkspaceIndexer - Indexování a vyhledávání v projektu
// Pro práci s velkými projekty ve VS Code

import * as vscode from 'vscode';
import * as path from 'path';

export interface FileInfo {
  path: string;
  relativePath: string;
  name: string;
  extension: string;
  size: number;
  isSource: boolean;
  language?: string;
}

export interface SymbolInfo {
  name: string;
  kind: vscode.SymbolKind;
  filePath: string;
  range: { start: number; end: number };
  containerName?: string;
}

export interface WorkspaceIndex {
  files: FileInfo[];
  symbols: SymbolInfo[];
  structure: string;
  summary: string;
  lastUpdated: number;
}

export interface ProjectMap {
  tree: string;
  keyFiles: string[];
  modules: Array<{ name: string; summary: string; files: string[] }>;
  lastUpdated: number;
}

export interface SearchResult {
  file: FileInfo;
  matches: { line: number; text: string; score: number }[];
  relevanceScore: number;
}

// Supported source file extensions
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw',
  '.java', '.kt', '.scala',
  '.cs', '.fs', '.vb',
  '.go',
  '.rs',
  '.cpp', '.c', '.cc', '.cxx', '.h', '.hpp',
  '.rb',
  '.php',
  '.swift',
  '.vue', '.svelte',
  '.sql',
  '.sh', '.bash', '.zsh', '.ps1',
  '.yaml', '.yml', '.json', '.xml', '.toml'
]);

// Files/folders to ignore
const IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  'bin',
  'obj',
  '.idea',
  '.vscode',
  'coverage',
  '.nyc_output',
  '*.min.js',
  '*.map',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml'
];

type OutputChannel = { appendLine: (msg: string) => void } | undefined;
let logChannel: OutputChannel = undefined;

export function setWorkspaceLogger(channel: OutputChannel): void {
  logChannel = channel;
}

export class WorkspaceIndexer {
  private index: WorkspaceIndex | null = null;
  private projectMap: ProjectMap | null = null;
  private projectMapDirty: boolean = false;
  private indexing: boolean = false;
  private maxFilesToIndex: number = 500;
  private maxFileSize: number = 100 * 1024; // 100KB

  /**
   * Scan workspace and create index
   */
  async scanWorkspace(onProgress?: (message: string) => void): Promise<WorkspaceIndex> {
    if (this.indexing) {
      logChannel?.appendLine('[WorkspaceIndexer] Already indexing...');
      return this.index || this.getEmptyIndex();
    }

    this.indexing = true;
    logChannel?.appendLine('[WorkspaceIndexer] ═══════════════════════════════════════');
    logChannel?.appendLine('[WorkspaceIndexer] 📂 Zahajuji skenování workspace...');
    onProgress?.('📂 Skenuji workspace...');

    const startTime = Date.now();
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders || workspaceFolders.length === 0) {
      logChannel?.appendLine('[WorkspaceIndexer] ⚠️ Žádný workspace není otevřen');
      this.indexing = false;
      return this.getEmptyIndex();
    }

    const files: FileInfo[] = [];
    const symbols: SymbolInfo[] = [];

    try {
      // Scan files
      for (const folder of workspaceFolders) {
        const folderFiles = await this.scanFolder(folder.uri, folder.uri);
        files.push(...folderFiles);
        
        if (files.length >= this.maxFilesToIndex) {
          logChannel?.appendLine(`[WorkspaceIndexer] ⚠️ Dosažen limit ${this.maxFilesToIndex} souborů`);
          break;
        }
      }

      onProgress?.(`📂 Nalezeno ${files.length} souborů, indexuji symboly...`);

      // Get symbols for source files (limited)
      const sourceFiles = files.filter(f => f.isSource).slice(0, 50);
      for (const file of sourceFiles) {
        try {
          const fileSymbols = await this.getFileSymbols(file.path);
          symbols.push(...fileSymbols);
        } catch {
          // Skip files that can't be parsed
        }
      }

      // Build structure tree
      const structure = this.buildStructureTree(files);
      const summary = this.buildSummary(files, symbols);
      const projectMap = this.buildProjectMap(files, symbols);

      this.index = {
        files,
        symbols,
        structure,
        summary,
        lastUpdated: Date.now()
      };
      this.projectMap = projectMap;
      this.projectMapDirty = false;

      const elapsed = Date.now() - startTime;
      logChannel?.appendLine(`[WorkspaceIndexer] ✅ Hotovo za ${elapsed}ms`);
      logChannel?.appendLine(`[WorkspaceIndexer] 📊 Soubory: ${files.length}, Symboly: ${symbols.length}`);
      onProgress?.(`✅ Index hotov: ${files.length} souborů, ${symbols.length} symbolů`);

    } catch (err) {
      logChannel?.appendLine(`[WorkspaceIndexer] ❌ Chyba: ${String(err)}`);
    } finally {
      this.indexing = false;
    }

    return this.index || this.getEmptyIndex();
  }

  /**
   * Scan a folder recursively
   */
  private async scanFolder(folderUri: vscode.Uri, rootUri: vscode.Uri): Promise<FileInfo[]> {
    const files: FileInfo[] = [];
    
    try {
      const entries = await vscode.workspace.fs.readDirectory(folderUri);
      
      for (const [name, type] of entries) {
        // Skip ignored patterns
        if (this.shouldIgnore(name)) continue;

        const entryUri = vscode.Uri.joinPath(folderUri, name);
        const relativePath = entryUri.path.replace(rootUri.path, '').replace(/^\//, '');

        if (type === vscode.FileType.Directory) {
          // Recurse into subdirectories
          const subFiles = await this.scanFolder(entryUri, rootUri);
          files.push(...subFiles);
        } else if (type === vscode.FileType.File) {
          try {
            const stat = await vscode.workspace.fs.stat(entryUri);
            
            // Skip large files
            if (stat.size > this.maxFileSize) continue;

            const ext = this.getExtension(name);
            files.push({
              path: entryUri.fsPath,
              relativePath,
              name,
              extension: ext,
              size: stat.size,
              isSource: SOURCE_EXTENSIONS.has(ext),
              language: this.getLanguage(ext)
            });
          } catch {
            // Skip files we can't stat
          }
        }

        // Limit total files
        if (files.length >= this.maxFilesToIndex) break;
      }
    } catch {
      // Skip folders we can't read
    }

    return files;
  }

  /**
   * Check if path should be ignored
   */
  private shouldIgnore(name: string): boolean {
    return IGNORE_PATTERNS.some(pattern => {
      if (pattern.startsWith('*')) {
        return name.endsWith(pattern.slice(1));
      }
      return name === pattern;
    });
  }

  /**
   * Get file extension
   */
  private getExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.');
    return lastDot > 0 ? filename.slice(lastDot).toLowerCase() : '';
  }

  /**
   * Map extension to language
   */
  private getLanguage(ext: string): string | undefined {
    const langMap: Record<string, string> = {
      '.ts': 'typescript', '.tsx': 'typescriptreact',
      '.js': 'javascript', '.jsx': 'javascriptreact',
      '.py': 'python',
      '.java': 'java', '.kt': 'kotlin',
      '.cs': 'csharp',
      '.go': 'go',
      '.rs': 'rust',
      '.cpp': 'cpp', '.c': 'c', '.h': 'cpp',
      '.rb': 'ruby',
      '.php': 'php',
      '.swift': 'swift',
      '.vue': 'vue', '.svelte': 'svelte',
      '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml'
    };
    return langMap[ext];
  }

  /**
   * Get symbols from a file using VS Code API
   */
  private async getFileSymbols(filePath: string): Promise<SymbolInfo[]> {
    const uri = vscode.Uri.file(filePath);
    const symbols: SymbolInfo[] = [];

    try {
      const docSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        uri
      );

      if (docSymbols) {
        this.flattenSymbols(docSymbols, filePath, symbols);
      }
    } catch {
      // File might not have symbol provider
    }

    return symbols;
  }

  /**
   * Flatten nested symbols
   */
  private flattenSymbols(
    docSymbols: vscode.DocumentSymbol[],
    filePath: string,
    result: SymbolInfo[],
    containerName?: string
  ): void {
    for (const sym of docSymbols) {
      // Only include important symbols
      if (this.isImportantSymbol(sym.kind)) {
        result.push({
          name: sym.name,
          kind: sym.kind,
          filePath,
          range: { start: sym.range.start.line, end: sym.range.end.line },
          containerName
        });
      }

      // Recurse into children
      if (sym.children && sym.children.length > 0) {
        this.flattenSymbols(sym.children, filePath, result, sym.name);
      }
    }
  }

  /**
   * Check if symbol is important enough to index
   */
  private isImportantSymbol(kind: vscode.SymbolKind): boolean {
    const importantKinds = [
      vscode.SymbolKind.Class,
      vscode.SymbolKind.Interface,
      vscode.SymbolKind.Function,
      vscode.SymbolKind.Method,
      vscode.SymbolKind.Enum,
      vscode.SymbolKind.Module,
      vscode.SymbolKind.Namespace
    ];
    return importantKinds.includes(kind);
  }

  /**
   * Build folder structure tree
   */
  private buildStructureTree(files: FileInfo[]): string {
    const tree: Record<string, string[]> = {};
    
    for (const file of files) {
      const parts = file.relativePath.split('/');
      const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
      
      if (!tree[folder]) tree[folder] = [];
      tree[folder].push(parts[parts.length - 1]);
    }

    const lines: string[] = [];
    const sortedFolders = Object.keys(tree).sort();
    
    for (const folder of sortedFolders.slice(0, 30)) { // Limit output
      lines.push(`📁 ${folder}/`);
      const folderFiles = tree[folder].slice(0, 10);
      for (const f of folderFiles) {
        lines.push(`   ${f}`);
      }
      if (tree[folder].length > 10) {
        lines.push(`   ... a ${tree[folder].length - 10} dalších`);
      }
    }

    if (sortedFolders.length > 30) {
      lines.push(`... a ${sortedFolders.length - 30} dalších složek`);
    }

    return lines.join('\n');
  }

  /**
   * Build summary of workspace
   */
  private buildSummary(files: FileInfo[], symbols: SymbolInfo[]): string {
    const byLang: Record<string, number> = {};
    let totalSize = 0;

    for (const file of files) {
      const lang = file.language || 'other';
      byLang[lang] = (byLang[lang] || 0) + 1;
      totalSize += file.size;
    }

    const langSummary = Object.entries(byLang)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([lang, count]) => `${lang}: ${count}`)
      .join(', ');

    const classCount = symbols.filter(s => s.kind === vscode.SymbolKind.Class).length;
    const funcCount = symbols.filter(s => 
      s.kind === vscode.SymbolKind.Function || s.kind === vscode.SymbolKind.Method
    ).length;

    return `Projekt: ${files.length} souborů (${(totalSize / 1024).toFixed(1)} KB)
Jazyky: ${langSummary}
Symboly: ${classCount} tříd, ${funcCount} funkcí/metod`;
  }

  /**
   * Build project map (tree + key files + modules)
   */
  private buildProjectMap(files: FileInfo[], symbols: SymbolInfo[]): ProjectMap {
    const tree = this.buildCompactTree(files, 3, 80, 12);
    const keyFiles = this.findKeyFiles(files);
    const modules = this.buildModuleSummaries(files, symbols);
    return {
      tree,
      keyFiles,
      modules,
      lastUpdated: Date.now()
    };
  }

  private buildCompactTree(
    files: FileInfo[],
    maxDepth: number,
    maxFolders: number,
    maxFilesPerFolder: number
  ): string {
    const folderMap = new Map<string, string[]>();

    for (const file of files) {
      const parts = file.relativePath.split('/').filter(Boolean);
      const depth = Math.max(0, parts.length - 1);
      if (depth > maxDepth) continue;
      const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
      if (!folderMap.has(folder)) folderMap.set(folder, []);
      folderMap.get(folder)!.push(parts[parts.length - 1]);
    }

    const folders = Array.from(folderMap.keys()).sort();
    const lines: string[] = [];
    for (const folder of folders.slice(0, maxFolders)) {
      lines.push(`- ${folder}/`);
      const filesInFolder = (folderMap.get(folder) || []).sort();
      for (const name of filesInFolder.slice(0, maxFilesPerFolder)) {
        lines.push(`  - ${name}`);
      }
      if (filesInFolder.length > maxFilesPerFolder) {
        lines.push(`  - ... (${filesInFolder.length - maxFilesPerFolder} more)`);
      }
    }
    if (folders.length > maxFolders) {
      lines.push(`- ... (${folders.length - maxFolders} more folders)`);
    }
    return lines.join('\n');
  }

  private findKeyFiles(files: FileInfo[]): string[] {
    const keyPatterns = [
      /^readme/i,
      /^license/i,
      /^package\.json$/i,
      /^tsconfig(\..*)?\.json$/i,
      /^jsconfig(\..*)?\.json$/i,
      /^vite\.config\./i,
      /^webpack\.config\./i,
      /^rollup\.config\./i,
      /^eslint(\..*)?\.c?js$/i,
      /^prettier(\..*)?\.c?js$/i,
      /^\.prettierrc/i,
      /^\.eslintrc/i,
      /^dockerfile$/i,
      /^compose\.ya?ml$/i,
      /^\.github\/workflows\//i,
      /^\.gitlab-ci\.yml$/i,
      /^\.circleci\//i,
      /^\.vscode\//i,
      /^README\.md$/i
    ];
    const entryPatterns = [/^index\./i, /^main\./i, /^app\./i, /^server\./i, /^extension\./i];

    const hits = new Set<string>();
    for (const file of files) {
      const base = file.name;
      const rel = file.relativePath;
      if (keyPatterns.some(rx => rx.test(rel) || rx.test(base))) {
        hits.add(rel);
        continue;
      }
      if (entryPatterns.some(rx => rx.test(base)) && rel.split('/').length <= 3) {
        hits.add(rel);
      }
    }

    return Array.from(hits).sort().slice(0, 40);
  }

  private buildModuleSummaries(files: FileInfo[], symbols: SymbolInfo[]): Array<{ name: string; summary: string; files: string[] }> {
    const moduleMap = new Map<string, FileInfo[]>();
    for (const file of files) {
      const parts = file.relativePath.split('/').filter(Boolean);
      if (parts.length === 0) continue;
      let moduleName = parts[0];
      if (moduleName === 'src' && parts.length > 1) {
        moduleName = `src/${parts[1]}`;
      }
      if (!moduleMap.has(moduleName)) moduleMap.set(moduleName, []);
      moduleMap.get(moduleName)!.push(file);
    }

    const modules: Array<{ name: string; summary: string; files: string[]; fileCount: number }> = [];
    for (const [name, moduleFiles] of moduleMap.entries()) {
      const entryCandidates = moduleFiles
        .filter(f => /^(index|main|app|server|extension)\./i.test(f.name))
        .map(f => f.relativePath)
        .slice(0, 3);
      const moduleFilePaths = new Set(moduleFiles.map(f => f.path));
      const symbolCount = symbols.filter(s => moduleFilePaths.has(s.filePath)).length;
      const summary = `files: ${moduleFiles.length}, entries: ${entryCandidates.length > 0 ? entryCandidates.join(', ') : 'none'}, symbols: ${symbolCount}`;
      const fileList = moduleFiles
        .map(f => f.relativePath)
        .sort()
        .slice(0, 8);
      modules.push({ name, summary, files: fileList, fileCount: moduleFiles.length });
    }

    return modules
      .sort((a, b) => b.fileCount - a.fileCount)
      .slice(0, 12)
      .map(({ name, summary, files }) => ({ name, summary, files }));
  }

  markProjectMapDirty(): void {
    this.projectMapDirty = true;
  }

  /**
   * Search files by query
   */
  async searchFiles(query: string, maxResults: number = 10): Promise<SearchResult[]> {
    if (!this.index) {
      await this.scanWorkspace();
    }
    if (!this.index) return [];

    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

    for (const file of this.index.files) {
      // Score by filename match
      let score = 0;
      const nameLower = file.name.toLowerCase();
      const pathLower = file.relativePath.toLowerCase();

      if (nameLower.includes(queryLower)) score += 10;
      if (pathLower.includes(queryLower)) score += 5;
      
      for (const word of queryWords) {
        if (nameLower.includes(word)) score += 3;
        if (pathLower.includes(word)) score += 1;
      }

      // Check symbols in this file
      const fileSymbols = this.index.symbols.filter(s => s.filePath === file.path);
      for (const sym of fileSymbols) {
        if (sym.name.toLowerCase().includes(queryLower)) score += 8;
        for (const word of queryWords) {
          if (sym.name.toLowerCase().includes(word)) score += 2;
        }
      }

      if (score > 0) {
        results.push({
          file,
          matches: [],
          relevanceScore: score
        });
      }
    }

    // Sort by score and limit
    return results
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, maxResults);
  }

  /**
   * Find relevant files for a prompt
   */
  async findRelevantContext(prompt: string, maxFiles: number = 5): Promise<string> {
    const results = await this.searchFiles(prompt, maxFiles);
    
    if (results.length === 0) {
      return 'Nenalezeny relevantní soubory.';
    }

    const contextParts: string[] = [];
    contextParts.push(`📂 Relevantní soubory (${results.length}):`);

    for (const result of results) {
      contextParts.push(`\n--- ${result.file.relativePath} (skóre: ${result.relevanceScore}) ---`);
      
      // Try to read file content (truncated)
      try {
        const uri = vscode.Uri.file(result.file.path);
        const content = await vscode.workspace.fs.readFile(uri);
        const text = new TextDecoder().decode(content);
        const truncated = text.slice(0, 2000);
        contextParts.push(truncated);
        if (text.length > 2000) {
          contextParts.push(`... (zkráceno, celkem ${text.length} znaků)`);
        }
      } catch {
        contextParts.push('(nelze přečíst)');
      }
    }

    return contextParts.join('\n');
  }

  /**
   * Get workspace summary for AI context
   */
  getWorkspaceSummary(): string {
    if (!this.index) {
      return 'Workspace nebyl indexován. Použij příkaz pro skenování.';
    }

    return `${this.index.summary}

STRUKTURA:
${this.index.structure}`;
  }

  /**
   * Get current index
   */
  getIndex(): WorkspaceIndex | null {
    return this.index;
  }

  /**
   * Get current project map
   */
  getProjectMap(): ProjectMap | null {
    if (!this.projectMap && this.index) {
      this.projectMap = this.buildProjectMap(this.index.files, this.index.symbols);
      this.projectMapDirty = false;
    }
    if (!this.projectMap) return null;
    if (this.projectMapDirty && this.index) {
      this.projectMap = this.buildProjectMap(this.index.files, this.index.symbols);
      this.projectMapDirty = false;
    }
    return this.projectMap;
  }

  getProjectMapForFolder(folder: vscode.WorkspaceFolder): ProjectMap | null {
    if (!this.index) return null;
    const rootPath = path.resolve(folder.uri.fsPath);
    const files = this.index.files.filter(file => {
      const filePath = path.resolve(file.path);
      return filePath === rootPath || filePath.startsWith(rootPath + path.sep);
    });
    if (files.length === 0) return null;
    const filePathSet = new Set(files.map(file => file.path));
    const symbols = this.index.symbols.filter(symbol => filePathSet.has(symbol.filePath));
    return this.buildProjectMap(files, symbols);
  }

  async updateFile(uri: vscode.Uri): Promise<void> {
    if (!this.index) return;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) return;
    const relativePath = uri.path.replace(workspaceFolder.uri.path, '').replace(/^\//, '');
    const name = relativePath.split('/').pop() || uri.path.split('/').pop() || '';
    if (!name || this.shouldIgnore(name)) return;

    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > this.maxFileSize) {
        this.removeFile(uri);
        return;
      }
      const ext = this.getExtension(name);
      const existingIndex = this.index.files.findIndex(f => f.path === uri.fsPath);
      const fileInfo: FileInfo = {
        path: uri.fsPath,
        relativePath,
        name,
        extension: ext,
        size: stat.size,
        isSource: SOURCE_EXTENSIONS.has(ext),
        language: this.getLanguage(ext)
      };
      if (existingIndex >= 0) {
        this.index.files[existingIndex] = fileInfo;
      } else {
        this.index.files.push(fileInfo);
      }

      this.index.symbols = this.index.symbols.filter(s => s.filePath !== uri.fsPath);
      if (fileInfo.isSource) {
        const fileSymbols = await this.getFileSymbols(uri.fsPath);
        this.index.symbols.push(...fileSymbols);
      }

      this.refreshDerived();
    } catch {
      // ignore update errors
    }
  }

  removeFile(uri: vscode.Uri): void {
    if (!this.index) return;
    this.index.files = this.index.files.filter(f => f.path !== uri.fsPath);
    this.index.symbols = this.index.symbols.filter(s => s.filePath !== uri.fsPath);
    this.refreshDerived();
  }

  /**
   * Clear index
   */
  clearIndex(): void {
    this.index = null;
    this.projectMap = null;
    this.projectMapDirty = false;
    logChannel?.appendLine('[WorkspaceIndexer] 🗑️ Index vymazán');
  }

  private refreshDerived(): void {
    if (!this.index) return;
    this.index.structure = this.buildStructureTree(this.index.files);
    this.index.summary = this.buildSummary(this.index.files, this.index.symbols);
    this.index.lastUpdated = Date.now();
    this.projectMapDirty = true;
  }

  /**
   * Get empty index
   */
  private getEmptyIndex(): WorkspaceIndex {
    return {
      files: [],
      symbols: [],
      structure: '',
      summary: 'Prázdný workspace',
      lastUpdated: Date.now()
    };
  }
}

// Global instance
export const workspaceIndexer = new WorkspaceIndexer();
