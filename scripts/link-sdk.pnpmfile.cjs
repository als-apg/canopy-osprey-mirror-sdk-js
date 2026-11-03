// Consumer-side dev linking for canopy-sdk-js.
//
// Lets an app (react-trace, react-squirrel, ...) develop against this local SDK
// checkout instead of the published @slaclab/canopy-* packages, without
// changing any file in the app repo. Opt in per shell, from the app:
//
//   PowerShell:
//     $env:pnpm_config_pnpmfile = '<sdk checkout>\scripts\link-sdk.pnpmfile.cjs'
//     $env:pnpm_config_lockfile = 'false'
//     pnpm install
//   POSIX shells:
//     pnpm_config_pnpmfile=<sdk checkout>/scripts/link-sdk.pnpmfile.cjs \
//     pnpm_config_lockfile=false pnpm install
//
// `lockfile=false` keeps the app's committed pnpm-lock.yaml untouched (the
// link: specifiers written here are machine-specific). Unset both variables
// and run `pnpm install` again to go back to the published packages.
//
// The hook rewrites every @slaclab/canopy-* dependency found in this workspace's
// packages/*/package.json to a link: to that package. Consumers import the
// built dist/, so build the SDK first (`pnpm build`, or `pnpm build:watch`).
//
// Linked packages resolve their imports from this checkout's node_modules, so
// the app must dedupe the shared libraries or it loads two copies of React
// ("Invalid hook call"), Carbon and ECharts. In the app's vite.config.ts:
//   resolve: { dedupe: ['react', 'react-dom', '@carbon/react', 'echarts'] }
// (README.md, "Developing an app against a local SDK checkout").
const fs = require('node:fs');
const path = require('node:path');

const SDK_ROOT = path.resolve(__dirname, '..');
const PACKAGES_DIR = path.join(SDK_ROOT, 'packages');

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function discoverPackages() {
  const found = {};
  for (const entry of fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = path.join(PACKAGES_DIR, entry.name, 'package.json');
    if (!fs.existsSync(manifest)) continue;
    const { name } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    if (typeof name === 'string' && name.startsWith('@slaclab/canopy-')) {
      found[name] = toPosix(path.join(PACKAGES_DIR, entry.name));
    }
  }
  return found;
}

const LOCAL = discoverPackages();
const FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];

module.exports = {
  hooks: {
    readPackage(pkg, context) {
      // Leave the SDK's own workspace packages alone (they use workspace:^).
      if (pkg.name && LOCAL[pkg.name]) return pkg;
      for (const field of FIELDS) {
        const deps = pkg[field];
        if (!deps) continue;
        for (const name of Object.keys(deps)) {
          if (LOCAL[name]) {
            deps[name] = `link:${LOCAL[name]}`;
            context.log(`[canopy-sdk] ${pkg.name ?? '(root)'}: ${name} -> ${LOCAL[name]}`);
          }
        }
      }
      return pkg;
    },
  },
};
