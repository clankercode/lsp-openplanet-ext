import * as vscode from 'vscode';
import * as path from 'path';
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration('openplanetLsp');
  const overridePath = config.get<string>('serverPath', '');

  // Resolution order: user override → bundled binary → PATH.
  // The bundled binary lands in `bin/` at VSIX install time (M4/M6);
  // for now, fall back to PATH via the bare command name.
  const serverBin =
    overridePath.trim() ||
    context.asAbsolutePath(
      path.join('bin', process.platform === 'win32' ? 'openplanet-lsp.exe' : 'openplanet-lsp'),
    ) ||
    'openplanet-lsp';

  const serverOptions: ServerOptions = {
    command: serverBin,
    transport: TransportKind.stdio,
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'angelscript' },
      { scheme: 'untitled', language: 'angelscript' },
    ],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.as'),
    },
  };

  client = new LanguageClient('openplanet-lsp', 'OpenPlanet LSP', serverOptions, clientOptions);

  context.subscriptions.push(client);
  void client.start();
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
