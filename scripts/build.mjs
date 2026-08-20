import { buildSync } from 'esbuild'
import { copyFileSync, mkdirSync, renameSync, rmSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

mkdirSync(join(root, 'dist'), { recursive: true })

function emit(outfile, build) {
  const tmpfile = `${outfile}.tmp`
  rmSync(tmpfile, { force: true })
  try {
    buildSync({ ...build, outfile: tmpfile })
  } catch (err) {
    console.error(err)
    rmSync(tmpfile, { force: true })
    process.exit(1)
  }
  try {
    renameSync(tmpfile, outfile)
  } catch {
    copyFileSync(tmpfile, outfile)
    unlinkSync(tmpfile)
  }
}

emit(join(root, 'dist', 'index.js'), {
  entryPoints: [join(root, 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: [
    '@deepseek-ai/cordis',
    '@deepseek-ai/schemastery',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-credentials',
    '@deepseek-ai/dsh-launch-environment',
    '@deepseek-ai/dsh-settings',
    '@deepseek-ai/dsh-timeout',
    '@deepseek-ai/dsh-home-paths',
    '@deepseek-ai/dsh-attachment',
  ],
})

emit(join(root, 'dist', 'client.js'), {
  entryPoints: [join(root, 'src', 'client', 'index.ts')],
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  jsx: 'automatic',
  banner: {
    js: 'window.__ModuleLoader__.load({ id: "dsh-provider-qoder", factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;',
  },
  footer: {
    js: 'return module.exports;\n}});',
  },
  external: [
    'react',
    'react/jsx-runtime',
    'react-dom',
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-runtime/client',
    '@deepseek-ai/dsh-client-connection/client',
    '@deepseek-ai/dsh-client-locale/client',
    '@deepseek-ai/dsh-client-ui-settings/client',
    '@deepseek-ai/dsh-client-ui-settings-plugins/client',
    '@deepseek-ai/dsh-api-remotes/client',
  ],
})
