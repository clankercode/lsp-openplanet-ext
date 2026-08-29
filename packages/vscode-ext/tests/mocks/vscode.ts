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

export interface FakeQuickPickCall {
  items: unknown[];
  options: FakeQuickPickOptions | undefined;
}

export interface FakeQuickPickOptions {
  canPickMany?: boolean;
  title?: string;
  placeHolder?: string;
  ignoreFocusOut?: boolean;
  matchOnDescription?: boolean;
  matchOnDetail?: boolean;
}

export interface FakeInputBoxOptions {
  title?: string;
  prompt?: string;
  placeHolder?: string;
  value?: string;
  ignoreFocusOut?: boolean;
  validateInput?: (
    value: string,
  ) => string | { message: string; severity: number } | undefined | null;
}

export interface FakeMessageCall {
  message: string;
  options: unknown;
  items: string[];
}

export interface FakeConfigUpdate {
  section: string;
  key: string;
  value: unknown;
  target: number | undefined;
}

export interface Recorded {
  outputChannels: FakeOutputChannel[];
  statusBarItems: FakeStatusBarItem[];
  commands: Map<string, (...args: unknown[]) => unknown>;
  executedCommands: { command: string; args: unknown[] }[];
  shownTextDocuments: FakeTextDocument[];
  openedTextDocuments: FakeTextDocument[];
  warnings: string[];
  errors: string[];
  infos: string[];
  /** Full modal/message calls, so the offered buttons can be asserted. */
  messages: FakeMessageCall[];
  quickPicks: FakeQuickPickCall[];
  inputBoxes: FakeInputBoxOptions[];
  /** Every `WorkspaceConfiguration.update` call, in order. */
  configUpdates: FakeConfigUpdate[];
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
  infos: [],
  messages: [],
  quickPicks: [],
  inputBoxes: [],
  configUpdates: [],
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
  recorded.infos = [];
  recorded.messages = [];
  recorded.quickPicks = [];
  recorded.inputBoxes = [];
  recorded.configUpdates = [];
  recorded.watchers = [];
  recorded.disposedCount = 0;
  configValues = {};
  configScopes = {};
  workspaceFoldersValue = undefined;
  activeTextEditorValue = undefined;
  activeEditorListeners = [];
  configListeners = [];
  quickPickQueue = [];
  inputBoxQueue = [];
  messageQueue = [];
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

/** Per-scope values for one setting, as `inspect()` reports them. */
export interface FakeConfigScopes {
  globalValue?: unknown;
  workspaceValue?: unknown;
}

/** Test-facing setters for the ambient workspace/editor state. */
let configValues: Record<string, unknown> = {};
let configScopes: Record<string, FakeConfigScopes> = {};
let workspaceFoldersValue: FakeWorkspaceFolder[] | undefined;
let activeTextEditorValue: { document: { uri: FakeUri } } | undefined;
let activeEditorListeners: ((e: unknown) => void)[] = [];
let configListeners: ((e: { affectsConfiguration: (s: string) => boolean }) => void)[] = [];

/** Scripted answers, consumed one per call. */
type QuickPickResponder = (items: unknown[], options: FakeQuickPickOptions | undefined) => unknown;
type InputBoxResponder = (options: FakeInputBoxOptions) => string | undefined;
type MessageResponder = (message: string, items: string[]) => string | undefined;

let quickPickQueue: QuickPickResponder[] = [];
let inputBoxQueue: InputBoxResponder[] = [];
let messageQueue: MessageResponder[] = [];

export function __setConfig(values: Record<string, unknown>): void {
  configValues = values;
}

/**
 * Give a setting distinct user-global and workspace values.
 *
 * `get()` then resolves the way VS Code does for a non-object setting: the
 * workspace value REPLACES the user one, it does not merge with it — which is
 * exactly the trap the defines scope logic has to handle.
 */
export function __setConfigScopes(scopes: Record<string, FakeConfigScopes>): void {
  configScopes = scopes;
}

/**
 * Queue one answer for the next `showQuickPick`. Unqueued calls THROW rather
 * than resolving undefined: a forgotten script should fail the test loudly,
 * not look like the user pressed Escape.
 */
export function __queueQuickPick(responder: QuickPickResponder): void {
  quickPickQueue.push(responder);
}

/** Queue one answer for the next `showInputBox`. Unqueued calls throw. */
export function __queueInputBox(responder: InputBoxResponder): void {
  inputBoxQueue.push(responder);
}

/**
 * Queue one answer for the next warning/information message with buttons.
 * Unlike the pickers these fall back to `undefined` (dismissed) when
 * unqueued, because plain notifications are fire-and-forget.
 */
export function __queueMessageResponse(responder: MessageResponder): void {
  messageQueue.push(responder);
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

/**
 * Record a message call and answer it from the queue.
 *
 * The real signatures are `(message, ...items)` and
 * `(message, options, ...items)`; both are flattened to the button labels.
 */
function answerMessage(message: string, rest: unknown[]): string | undefined {
  const options = typeof rest[0] === 'object' && rest[0] !== null ? rest[0] : undefined;
  const items = (options ? rest.slice(1) : rest).filter((i): i is string => typeof i === 'string');
  recorded.messages.push({ message, options, items });
  return messageQueue.shift()?.(message, items);
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
  showWarningMessage(msg: string, ...rest: unknown[]): Promise<string | undefined> {
    recorded.warnings.push(msg);
    return Promise.resolve(answerMessage(msg, rest));
  },
  showErrorMessage(msg: string, ...rest: unknown[]): Promise<string | undefined> {
    recorded.errors.push(msg);
    return Promise.resolve(answerMessage(msg, rest));
  },
  showInformationMessage(msg: string, ...rest: unknown[]): Promise<string | undefined> {
    recorded.infos.push(msg);
    return Promise.resolve(answerMessage(msg, rest));
  },
  showQuickPick(items: unknown[], options?: FakeQuickPickOptions): Promise<unknown> {
    recorded.quickPicks.push({ items, options });
    const responder = quickPickQueue.shift();
    if (!responder) {
      throw new Error(
        `unscripted showQuickPick (title=${options?.title ?? '?'}); ` +
          'queue one with __queueQuickPick',
      );
    }
    return Promise.resolve(responder(items, options));
  },
  showInputBox(options?: FakeInputBoxOptions): Promise<string | undefined> {
    const opts = options ?? {};
    recorded.inputBoxes.push(opts);
    const responder = inputBoxQueue.shift();
    if (!responder) {
      throw new Error(
        `unscripted showInputBox (title=${opts.title ?? '?'}); queue one with __queueInputBox`,
      );
    }
    return Promise.resolve(responder(opts));
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
        const scoped = configScopes[`${section}.${key}`];
        // A non-object setting does not merge across scopes: workspace wins
        // outright, then user, then the package.json default.
        const v = scoped
          ? (scoped.workspaceValue ?? scoped.globalValue)
          : configValues[`${section}.${key}`];
        return (v === undefined ? fallback : v) as T;
      },
      inspect<T>(key: string) {
        const scoped = configScopes[`${section}.${key}`] ?? {};
        return {
          key: `${section}.${key}`,
          globalValue: scoped.globalValue as T | undefined,
          workspaceValue: scoped.workspaceValue as T | undefined,
        };
      },
      update(key: string, value: unknown, target?: number): Promise<void> {
        recorded.configUpdates.push({ section, key, value, target });
        // Keep the scope map consistent so a command that reads back after
        // writing sees what it wrote — and so a workspace write is visibly
        // NOT a user write.
        const full = `${section}.${key}`;
        const scoped = { ...(configScopes[full] ?? {}) };
        if (target === ConfigurationTarget.Global) scoped.globalValue = value;
        else scoped.workspaceValue = value;
        configScopes = { ...configScopes, [full]: scoped };
        return Promise.resolve();
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

/** Mirrors the real enum values — the extension writes to these targets. */
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 } as const;

export const QuickPickItemKind = { Separator: -1, Default: 0 } as const;

export const InputBoxValidationSeverity = { Ignore: 0, Info: 1, Warning: 2, Error: 3 } as const;

export const env = { appName: 'Visual Studio Code' };
export const version = '1.99.0-test';

export const extensions = {
  getExtension(_id: string) {
    return undefined;
  },
};
