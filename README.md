# dsh-provider-qoder

Qoder CN adapter plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Installs the `qoder-cn` provider route: COSY-signed, WAF-encoded streaming against `gateway.qoder.com.cn`. A Qoder PAT (`pt-...`) is stored through the Models page and exchanged per process for a short-lived job token.

## Install

Requires DeepSeek Harness `0.2.1-alpha.1` or newer in the `0.2.x` line and pnpm. Verified against the official `0.2.1-alpha.2` runtime.

```sh
dsh plugin --profile web add github:minglu6/dsh-provider-qoder
dsh web
```

Open **Settings → Models → Qoder CN → Edit connection**. This card ships with the plugin and uses the official Models-page extension slot; no Harness source patch is required. Enter a PAT, and optionally an enterprise VPC instance ID. Leave the instance empty for the public CN cloud. Advanced settings allow explicit Gateway and OpenAPI URLs.

The card never reads back the PAT. Leaving its input empty preserves the existing credential; environment-owned credentials are read-only. Connection changes take effect on the next request. If configuration saves but credential storage fails, the card keeps the token draft and reports the partial save for retry. A stale configuration revision is rejected before writing a token.

The npm package named `dsh-provider-qoder` belongs to a different project. Install this implementation from `github:minglu6/dsh-provider-qoder`, or link this local checkout after building:

```sh
npm install
npm run build
dsh plugin --profile web link /absolute/path/to/dsh-provider-qoder
```

Restart the Web profile after installing or rebuilding the plugin's browser bundle.

Remove:

```sh
dsh plugin --profile web remove dsh-provider-qoder
```

From a DeepSeek Harness checkout:

```sh
pnpm dsh plugin --profile web add github:minglu6/dsh-provider-qoder
pnpm dsh web
```

## Config

The bundle mounts the `llm-qoder` entry. Its live configuration is persisted through DSH's profile `cordis.patch.yml`, and PATs are stored through the DSH credentials service. The default credential reference is `QODERCN_PERSONAL_ACCESS_TOKEN`; a launch environment can supply that reference instead.

An existing `providers.qoder-cn` profile overrides only the fields it declares and inherits other root fields. The card edits that profile when present, otherwise the root. An explicit empty VPC instance selects public cloud instead of an inherited or environment-provided tenant. Empty URL overrides derive endpoints from the selected VPC or public cloud. Advanced configuration and model overrides not edited by the card are preserved.

Unless `models` is configured, the adapter fetches Qoder's signed live catalog from `/algo/api/v2/model/list` whenever DSH lists the provider. Newly released wire keys such as `gmodel` therefore appear without a plugin update; known wire keys retain stable selector ids such as `gm51model` → `glm-5.2`. Exact-model resolution reuses the latest successful catalog in the current process.

`models` remains an optional complete static override for deployments that intentionally pin the selector catalog. It replaces live discovery rather than extending it. Authentication, transport, invalid JSON, and empty-catalog failures surface as discovery errors instead of falling back to an obsolete built-in list.

## Development

```sh
npm ci
npm test
npm run typecheck
```

The build emits the Host adapter and a lazy-CJS browser bundle under `dist/`. Both are included in the package and tracked for direct GitHub installation. The adapter accepts the official request-message format, including standalone `role: tool` results.

## License

MIT
