import { buildSync } from 'esbuild'
import { copyFileSync, mkdirSync, renameSync, rmSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = join(root, 'dist', 'index.js')
const tmpfile = join(root, 'dist', 'index.js.tmp')

mkdirSync(join(root, 'dist'), { recursive: true })
rmSync(tmpfile, { force: true })

try {
  buildSync({
    entryPoints: [join(root, 'src', 'index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    // Downlevel `using` — Node's ESM loader rejects it as `Unexpected identifier`.
    target: 'node20',
    outfile: tmpfile,
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
      '@deepseek-ai/dsh-util-values',
    ],
  })
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
