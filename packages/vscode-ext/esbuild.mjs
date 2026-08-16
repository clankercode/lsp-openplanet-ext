import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  // VS Code extensions must externalise 'vscode'. vscode-languageclient
  // ships its own node_modules so we bundle it in for a self-contained VSIX.
  //
  // NOTE: if the resolver (`packages/binary-resolver`) is ever bundled in,
  // it uses createRequire(import.meta.url), which is undefined in a CJS
  // bundle. Add this define (verified fix direction):
  //   define: { 'import.meta.url': 'require("url").pathToFileURL(__filename).href' }
  external: ['vscode'],
  treeShaking: true,
  sourcemap: false,
  minify: false,
});
console.log('✅ extension bundled → dist/extension.js');
