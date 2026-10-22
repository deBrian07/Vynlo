import { build } from 'vite';
import { Buffer } from 'node:buffer';
import process from 'node:process';

// Bundle the same TypeScript client shipped in the extension without another runtime dependency.
const result = await build({
  configFile: false,
  logLevel: 'error',
  build: {
    ssr: 'scripts/evaluate-classifier.ts',
    write: false,
    minify: false,
    rollupOptions: { output: { format: 'es' } },
  },
});
const outputs = Array.isArray(result) ? result.flatMap((entry) => entry.output) : result.output;
const entry = outputs.find((output) => output.type === 'chunk' && output.isEntry);
if (!entry || entry.type !== 'chunk') throw new Error('Could not bundle the evaluation runner.');
const runner = await import(
  `data:text/javascript;base64,${Buffer.from(entry.code).toString('base64')}`
);
process.exitCode = await runner.runCli();
