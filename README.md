# dsh-provider-qoder

Qoder CN adapter plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Installs the `qoder-cn` provider route: COSY-signed, WAF-encoded streaming against `gateway.qoder.com.cn`. A Qoder PAT (`pt-...`) is stored from **Settings → Plugins** and exchanged per process for a short-lived job token.

## Install

From a machine that already has `dsh` and pnpm:

```sh
dsh plugin --profile web add github:minglu6/dsh-provider-qoder
dsh web
```

Then **Settings → Plugins → qoder-cn**. Paste a PAT. Public cloud needs only the PAT; enterprise VPC is optional on the same card.

The Models page does not offer a key field for third-party adapters. Configure the PAT here, then pick `qoder-cn` models in the composer.

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

## License

MIT
