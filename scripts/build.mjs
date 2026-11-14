import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const bridge = await build({
  absWorkingDir: root,
  entryPoints: ['src/bridge-cli.mjs'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  minify: true,
  legalComments: 'none',
  write: false,
});
const bridgeSource = bridge.outputFiles[0].text;
if (bridgeSource.length > 24000) {
  throw new Error('Bridge exceeds the portable Windows command-line allowance');
}
await mkdir(path.join(root, '.build'), { recursive: true });
await writeFile(path.join(root, '.build', 'bridge.cjs'), bridgeSource);
const plugin = await build({
  absWorkingDir: root,
  entryPoints: ['src/plugin.jsx'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  legalComments: 'none',
  write: false,
  metafile: true,
  plugins: [{
    name: 'embedded-native-bridge',
    setup(builder) {
      builder.onResolve({ filter: /bridge-cli\.mjs\?source$/ }, () => ({ path: 'native-bridge', namespace: 'embedded' }));
      builder.onLoad({ filter: /.*/, namespace: 'embedded' }, () => ({ contents: bridgeSource, loader: 'text' }));
    },
  }],
});
for (const output of Object.values(plugin.metafile.outputs)) {
  if (output.imports.length) throw new Error('Buzz external modules cannot contain runtime imports');
}
await mkdir(dist, { recursive: true });
await writeFile(path.join(dist, 'plugin.js'), plugin.outputFiles[0].text);
for (const filename of ['manifest.json', 'README.md', 'LICENSE']) {
  const contents = (await readFile(path.join(root, filename), 'utf8')).replace(/\r\n/g, '\n');
  await writeFile(path.join(dist, filename), contents);
}
const screenshots = ['harness-picker', 'token-setup', 'agent-options'].map(name => `docs/images/${name}.png`);
await mkdir(path.join(dist, 'docs', 'images'), { recursive: true });
for (const filename of screenshots) {
  await copyFile(path.join(root, filename), path.join(dist, filename));
}
const sums = [];
for (const filename of ['manifest.json', 'plugin.js', 'README.md', 'LICENSE', ...screenshots]) {
  const hash = createHash('sha256').update(await readFile(path.join(dist, filename))).digest('hex');
  sums.push(`${hash}  ${filename}`);
}
await writeFile(path.join(dist, 'SHA256SUMS'), sums.join('\n') + '\n');
console.log(`Built dist/plugin.js (${plugin.outputFiles[0].contents.length} bytes; embedded bridge ${bridgeSource.length} characters)`);
