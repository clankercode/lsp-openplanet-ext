/**
 * Minimal fake of the `vscode` extension API, aliased in for unit tests.
 *
 * The real module only exists inside an extension host, so activation-level
 * behaviour (command registration, the status bar item, disposal) is
 * otherwise untestable without a full integration harness. This fake
 * implements exactly the surface `src/extension.ts` touches, and records
 * enough to assert on.
 *
 * Anything the extension starts using must be added here — an unimplemented
 * member shows up as a TypeError in the failing test, not a silent pass.
 */

export interface Recorded {
  outputChannels: FakeOutputChannel[];
  statusBarItems: FakeStatusBarItem[];
  commands: Map<string, (...args: unknown[]) => unknown>;
  executedCommands: { command: string; args: unknown[] }[];
  shownTextDocuments: FakeTextDocument[];
  openedTextDocuments: FakeTextDocument[];
  warnings: string[];
  errors: string[];
  watchers: FakeDisposable[];
  /** Disposables handed to context.subscriptions by the extension. */
  disposedCount: number;
}

export const recorded: Recorded = {
  outputChannels: [],
  statusBarItems: [],
  commands: new Map(),
  executedCommands: [],
  shownTextDocuments: [],
  openedTextDocuments: [],
  warnings: [],
  errors: [],
  watchers: [],
  disposedCount: 0,
};

/** Reset all recorded state; call in beforeEach. */
export function __reset(): void {
  recorded.outputChannels = [];
  recorded.statusBarItems = [];
  recorded.commands = new Map();
  recorded.executedCommands = [];
  recorded.shownTextDocuments = [];
  recorded.openedTextDocuments = [];
  recorded.warnings = [];
  recorded.errors = [];
  recorded.watchers = [];
  recorded.disposedCount = 0;
  configValues = {};
  workspaceFoldersValue = undefined;
  activeTextEditorValue = undefined;
  activeEditorListeners = [];
  configListeners = [];
}

export class FakeDisposable {
  disposeCount = 0;
  constructor(private readonly onDispose?: () => void) {}
  dispose(): void {
    this.disposeCount += 1;
    recorded.disposedCount += 1;
    this.onDispose?.();
  }
}

export const Disposable = FakeDisposable;

export class FakeOutputChannel extends FakeDisposable {
  readonly lines: string[] = [];
  shownCount = 0;
  constructor(readonly channelName: string) {
    super();
  }
  appendLine(v: string): void {
    this.lines.push(v);
  }
  append(v: string): void {
    this.lines.push(v);
  }
  show(_preserveFocus?: boolean): void {
    this.shownCount += 1;
  }
  hide(): void {}
  clear(): void {
    this.lines.length = 0;
  }
  replace(_v: string): void {}
}

export class ThemeColor {
  constructor(readonly id: string) {}
}

export const StatusBarAlignment = { Left: 1, Right: 2 } as const;

export class FakeStatusBarItem extends FakeDisposable {
  text = '';
  tooltip: string | undefined;
  name: string | undefined;
  command: string | undefined;
  accessibilityInformation: { label: string } | undefined;
  backgroundColor: ThemeColor | undefined;
  color: string | ThemeColor | undefined;
  shownCount = 0;
  hiddenCount = 0;
  constructor(
    readonly id: string | undefined,
    readonly alignment: number,
    readonly priority: number | undefined,
  ) {
    super();
  }
  show(): void {
    this.shownCount += 1;
  }
  hide(): void {
    this.hiddenCount += 1;
  }
}

export interface FakeTextDocument {
  content: string;
  language?: string;
  uri: FakeUri;
}

export class FakeUri {
  constructor(readonly fsPath: string) {}
  static file(p: string): FakeUri {
    return new FakeUri(p);
  }
  toString(): string {
    return `file://${this.fsPath}`;
  }
}

export const Uri = FakeUri;

export interface FakeWorkspaceFolder {
  uri: FakeUri;
  name: string;
  index: number;
}

/** Test-facing setters for the ambient workspace/editor state. */
let configValues: Record<string, unknown> = {};
let workspaceFoldersValue: FakeWorkspaceFolder[] | undefined;
let activeTextEditorValue: { document: { uri: FakeUri } } | undefined;
let activeEditorListeners: ((e: unknown) => void)[] = [];
let configListeners: ((e: { affectsConfiguration: (s: string) => boolean }) => void)[] = [];

export function __setConfig(values: Record<string, unknown>): void {
  configValues = values;
}

export function __setWorkspaceFolders(paths: string[] | undefined): void {
  workspaceFoldersValue = paths?.map((p, index) => ({
    uri: new FakeUri(p),
    name: p,
    index,
  }));
}

export function __setActiveEditor(path: string | undefined): void {
  activeTextEditorValue = path === undefined ? undefined : { document: { uri: new FakeUri(path) } };
}

/** Fire the onDidChangeActiveTextEditor event the extension subscribed to. */
export function __fireActiveEditorChange(): void {
  for (const l of activeEditorListeners) l(activeTextEditorValue);
}

export function __fireConfigChange(section: string): void {
  for (const l of configListeners) {
    l({ affectsConfiguration: (s: string) => section.startsWith(s) });
  }
}

export const window = {
  get activeTextEditor() {
    return activeTextEditorValue;
  },
  createOutputChannel(name: string): FakeOutputChannel {
    const ch = new FakeOutputChannel(name);
    recorded.outputChannels.push(ch);
    return ch;
  },
  createStatusBarItem(a?: string | number, b?: number, c?: number): FakeStatusBarItem {
    // Both overloads: (alignment, priority) and (id, alignment, priority).
    const item =
      typeof a === 'string'
        ? new FakeStatusBarItem(a, b ?? StatusBarAlignment.Left, c)
        : new FakeStatusBarItem(undefined, a ?? StatusBarAlignment.Left, b);
    recorded.statusBarItems.push(item);
    return item;
  },
  showWarningMessage(msg: string, ..._items: string[]): Promise<string | undefined> {
    recorded.warnings.push(msg);
    return Promise.resolve(undefined);
  },
  showErrorMessage(msg: string, ..._items: string[]): Promise<string | undefined> {
    recorded.errors.push(msg);
    return Promise.resolve(undefined);
  },
  showInformationMessage(_msg: string, ..._items: string[]): Promise<string | undefined> {
    return Promise.resolve(undefined);
  },
  showTextDocument(doc: FakeTextDocument, _opts?: unknown): Promise<unknown> {
    recorded.shownTextDocuments.push(doc);
    return Promise.resolve({ document: doc });
  },
  onDidChangeActiveTextEditor(listener: (e: unknown) => void): FakeDisposable {
    activeEditorListeners.push(listener);
    return new FakeDisposable(() => {
      activeEditorListeners = activeEditorListeners.filter((l) => l !== listener);
    });
  },
};

export const workspace = {
  get workspaceFolders() {
    return workspaceFoldersValue;
  },
  getWorkspaceFolder(uri: FakeUri): FakeWorkspaceFolder | undefined {
    if (!workspaceFoldersValue) return undefined;
    // Longest matching prefix, mirroring VS Code's multi-root behaviour.
    let best: FakeWorkspaceFolder | undefined;
    for (const f of workspaceFoldersValue) {
      if (uri.fsPath === f.uri.fsPath || uri.fsPath.startsWith(f.uri.fsPath + '/')) {
        if (!best || f.uri.fsPath.length > best.uri.fsPath.length) best = f;
      }
    }
    return best;
  },
  getConfiguration(section: string) {
    return {
      get<T>(key: string, fallback: T): T {
        const v = configValues[`${section}.${key}`];
        return (v === undefined ? fallback : v) as T;
      },
    };
  },
  onDidChangeConfiguration(
    listener: (e: { affectsConfiguration: (s: string) => boolean }) => void,
  ): FakeDisposable {
    configListeners.push(listener);
    return new FakeDisposable(() => {
      configListeners = configListeners.filter((l) => l !== listener);
    });
  },
  createFileSystemWatcher(_glob: string): FakeDisposable {
    const w = new FakeDisposable();
    recorded.watchers.push(w);
    return w;
  },
  openTextDocument(opts: { content: string; language?: string }): Promise<FakeTextDocument> {
    const doc: FakeTextDocument = {
      content: opts.content,
      language: opts.language,
      uri: new FakeUri('untitled:status'),
    };
    recorded.openedTextDocuments.push(doc);
    return Promise.resolve(doc);
  },
};

export const commands = {
  registerCommand(id: string, handler: (...args: unknown[]) => unknown): FakeDisposable {
    recorded.commands.set(id, handler);
    return new FakeDisposable(() => recorded.commands.delete(id));
  },
  executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
    recorded.executedCommands.push({ command, args });
    const handler = recorded.commands.get(command);
    return Promise.resolve(handler ? handler(...args) : undefined);
  },
};

export const env = { appName: 'Visual Studio Code' };
export const version = '1.99.0-test';

export const extensions = {
  getExtension(_id: string) {
    return undefined;
  },
};
