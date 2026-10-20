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

Unless `models` is configured, the adapter fetches Qoder's signed live catalog from `/algo/api/v2/model/list` whenever DSH lists the provider. Model IDs are the upstream `key`, and labels are the upstream `display_name` (or the key when no name is supplied). Generation sends that same key unchanged in its headers and body. Distinct keys remain distinct even when their display names match.

Exact-model resolution reuses the latest successful catalog in the current process. The DSH browser also caches its model selector catalog: opening the menu repeatedly does not poll Qoder. Reload the page to request a fresh catalog, or let settings, credentials, or adapter changes trigger its refresh.

`models` remains an optional complete static override for deployments that intentionally pin the selector catalog. Every configured `id` must be an upstream wire key. This list replaces live discovery rather than extending it. Authentication failures surface as `AUTH` (and a rejected job-token session is dropped and retried once after a fresh exchange), transport, invalid JSON, and empty-catalog failures surface as discovery errors instead of falling back to a built-in list.

### Model-ID migration

Saved selections or static catalogs using versioned aliases such as `qwen3.6-flash`, `kimi-k2.6`, or `glm-5.2` must be reselected from the live directory or changed to the intended upstream key. Do not infer the key from an old version label: Qoder can rename or replace the model behind a key. `auto` is unchanged. Historical session logs are not rewritten. The `getQoderCNDirectModel` helper is no longer exported; callers send the selected upstream key directly.

### Tool-call history compatibility

Qoder can reject tool results when the preceding assistant message contains only tool calls and has `content: null`. The adapter adds a non-empty `(tool call)` marker to that assistant message on the wire, preserving call IDs, arguments, result order, and stored session history. Existing text and reasoning remain unchanged. After installing the updated plugin and restarting the Host, affected conversations can be retried without rewriting their history.

In-band upstream errors expose the nested provider message and gateway request ID rather than truncating the JSON wrapper before the actionable detail. Error classification and authentication retry behavior are unchanged.

## Development

```sh
npm ci
npm test
npm run typecheck
```

The build emits the Host adapter and a lazy-CJS browser bundle under `dist/`. Both are included in the package and tracked for direct GitHub installation. The adapter accepts the official request-message format, including standalone `role: tool` results.

## License

MIT
