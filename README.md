# dsh-provider-qoder

Qoder CN adapter plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Installs the `qoder-cn` provider route: COSY-signed, WAF-encoded streaming against `gateway.qoder.com.cn`. A Qoder PAT (`pt-...`) is stored through the Models page and exchanged per process for a short-lived job token.

## Install

From a machine that already has `dsh` and pnpm:

```sh
dsh plugin --profile web add github:minglu6/dsh-provider-qoder
dsh web
```

Then **Settings → Models → Add provider → qoder-cn**. Paste a PAT. Public cloud needs only the PAT; enterprise VPC can be set in `settings.yaml` (`llm-qoder.vpcInstance`).

The Models page key field for third-party adapters requires a DeepSeek Harness build that treats unknown adapter families as API-key cards. Until that lands upstream, export `QODERCN_PERSONAL_ACCESS_TOKEN`.

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

The plugin registers the `llm-qoder` settings namespace. Connection facts resolve per request. Leave gateway and OpenAPI URLs empty for public cloud.

Unless `models` is configured, the adapter fetches Qoder's signed live catalog from `/algo/api/v2/model/list` whenever DSH lists the provider. Newly released wire keys such as `gmodel` therefore appear without a plugin update; known wire keys retain stable selector ids such as `gm51model` → `glm-5.2`. Exact-model resolution reuses the latest successful catalog in the current process.

`models` remains an optional complete static override for deployments that intentionally pin the selector catalog. It replaces live discovery rather than extending it. Authentication, transport, invalid JSON, and empty-catalog failures surface as discovery errors instead of falling back to an obsolete built-in list.

## License

MIT
