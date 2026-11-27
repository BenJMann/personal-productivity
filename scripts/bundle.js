// Bundles the React renderer (JSX) into renderer/dist with esbuild.
// Takes ~100ms, so `npm start` runs it every time — no separate build step.
const esbuild = require('esbuild');
const path = require('path');

const watch = process.argv.includes('--watch');
const options = {
  entryPoints: [path.join(__dirname, '../renderer/src/index.jsx')],
  bundle: true,
  outfile: path.join(__dirname, '../renderer/dist/bundle.js'),
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  sourcemap: true,
  target: 'chrome120',
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  logLevel: 'warning',
};

(async () => {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('Watching renderer for changes...');
  } else {
    await esbuild.build(options);
  }
})().catch(() => process.exit(1));
