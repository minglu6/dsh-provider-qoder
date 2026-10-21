window.__ModuleLoader__.load({ id: "@lightmanlu/dsh-provider-qoder", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/QoderCard.tsx
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/operations.ts
var settingsNamespace = "llm-qoder";
var editableFields = ["vpcInstance", "baseURL", "openApiUrl"];
function connection(config) {
  const profile = config.providers?.["qoder-cn"];
  return {
    vpcInstance: profile?.vpcInstance ?? config.vpcInstance ?? "",
    baseURL: profile?.baseURL ?? config.baseURL ?? "",
    openApiUrl: profile?.openApiUrl ?? config.openApiUrl ?? "",
    ref: profile?.apiKeyEnv ?? config.apiKeyEnv ?? "QODERCN_PERSONAL_ACCESS_TOKEN",
    path: profile === void 0 ? [] : ["providers", "qoder-cn"]
  };
}
function createDraft(config, revision) {
  const { ref, path, ...fields } = connection(config);
  return { ...fields, ref, path, revision, pat: "", original: fields };
}
function draftOperations(draft) {
  return editableFields.flatMap((field) => {
    const value = draft[field].trim();
    return value === draft.original[field] ? [] : [{ op: "set", path: [...draft.path, field], value }];
  });
}
async function saveDraft(draft, snapshot, operations) {
  let retained = draft;
  let settingsSaved = false;
  const fail = (error) => ({ draft: retained, error, settingsSaved });
  if (snapshot.status !== "ready" || !snapshot.writable || snapshot.mode !== "host") return fail("readOnly");
  const pat = draft.pat.trim();
  if (pat) {
    try {
      const info = await operations.describe(draft.ref);
      if (!info) return fail("loadFailed");
      if (!info.writable) return fail("credentialReadOnly");
    } catch {
      return fail("loadFailed");
    }
  }
  const ops = draftOperations(draft);
  try {
    const written = await operations.mutate(ops, draft.revision);
    if (!written.ok) return fail(written.error.code === "settings/conflict" ? "conflict" : "settingsFailed");
    settingsSaved = ops.length > 0;
    retained = { ...createDraft(written.value.value, written.value.revision), pat: draft.pat };
  } catch {
    return fail("settingsFailed");
  }
  if (pat) {
    try {
      if (!await operations.store(retained.ref, pat)) return fail("credentialFailed");
    } catch {
      return fail("credentialFailed");
    }
  }
  return { draft: { ...retained, pat: "" }, settingsSaved };
}

// src/client/QoderCard.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function QoderCard({ form, operations, t }) {
  const subscribe = (0, import_react.useCallback)((listener) => form.subscribe(listener), [form]);
  const getSnapshot = (0, import_react.useCallback)(() => form.getSnapshot(), [form]);
  const snapshot = (0, import_react.useSyncExternalStore)(subscribe, getSnapshot);
  const effective = connection(snapshot.value ?? {});
  const [draft, setDraft] = (0, import_react.useState)();
  const [failure, setFailure] = (0, import_react.useState)();
  const [partial, setPartial] = (0, import_react.useState)(false);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const saving = (0, import_react.useRef)(false);
  const [refresh, setRefresh] = (0, import_react.useState)(0);
  const [credential, setCredential] = (0, import_react.useState)();
  const id = (0, import_react.useId)();
  const ref = draft?.ref ?? effective.ref;
  const info = credential?.ref === ref ? credential.info : void 0;
  const failed = credential?.ref === ref && credential.failed;
  const readOnly = snapshot.status !== "ready" || !snapshot.writable || snapshot.mode !== "host";
  (0, import_react.useEffect)(() => operations.subscribeCredentials(() => {
    setRefresh((value) => value + 1);
  }), [operations]);
  (0, import_react.useEffect)(() => {
    let active = true;
    if (snapshot.status !== "ready") return;
    void operations.describe(ref).then((info2) => {
      if (active) setCredential({ ref, info: info2, failed: info2 === void 0 });
    }).catch(() => {
      if (active) setCredential({ ref, failed: true });
    });
    return () => {
      active = false;
    };
  }, [operations, ref, refresh, snapshot.status]);
  const submit = async () => {
    if (!draft || saving.current) return;
    saving.current = true;
    setBusy(true);
    setFailure(void 0);
    try {
      const result = await saveDraft(draft, form.getSnapshot(), operations);
      setPartial((previous) => previous || result.settingsSaved && result.error !== void 0);
      if (result.error) {
        setDraft(result.draft);
        setFailure(result.error);
      } else {
        setDraft(void 0);
        setPartial(false);
      }
      setRefresh((value) => value + 1);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "qoder-cn-card", "aria-labelledby": `${id}-title`, "aria-busy": busy || snapshot.status === "loading", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "qoder-cn-card__header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { id: `${id}-title`, children: t("title") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "qoder-cn-card__status", children: t(info ? info.configured ? "configured" : "missing" : "unknown") }),
      !draft && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", disabled: readOnly, onClick: () => {
        if (snapshot.value === void 0 || snapshot.revision === void 0) return;
        setDraft(createDraft(snapshot.value, snapshot.revision));
        setFailure(void 0);
        setPartial(false);
      }, children: t("edit") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "qoder-cn-card__hint", children: t("intro") }),
    snapshot.status === "unavailable" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "qoder-cn-card__error", children: t("unavailable") }) : snapshot.status === "ready" && readOnly ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "qoder-cn-card__hint", children: t("readOnly") }) : null,
    failed && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "qoder-cn-card__notice", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("loadFailed") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { size: "sm", disabled: busy, onClick: () => {
        setRefresh((value) => value + 1);
      }, children: t("retry") })
    ] }),
    info?.writable === false && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "qoder-cn-card__hint", children: t("credentialReadOnly") }),
    !draft && snapshot.status === "ready" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "qoder-cn-card__hint", children: effective.vpcInstance || t("public") }),
    draft && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", { className: "qoder-cn-card__form", onSubmit: (event) => {
      event.preventDefault();
      void submit();
    }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "qoder-cn-card__field", htmlFor: `${id}-pat`, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("pat") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            id: `${id}-pat`,
            type: "password",
            autoComplete: "new-password",
            spellCheck: false,
            value: draft.pat,
            disabled: busy || readOnly || !info?.writable,
            "aria-describedby": `${id}-pat-hint`,
            onChange: (event) => {
              setDraft({ ...draft, pat: event.target.value });
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { id: `${id}-pat-hint`, className: "qoder-cn-card__hint", children: t("patHint") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "qoder-cn-card__field", htmlFor: `${id}-vpc`, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("vpc") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            id: `${id}-vpc`,
            type: "text",
            autoComplete: "off",
            spellCheck: false,
            value: draft.vpcInstance,
            disabled: busy || readOnly,
            "aria-describedby": `${id}-vpc-hint`,
            onChange: (event) => {
              setDraft({ ...draft, vpcInstance: event.target.value });
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { id: `${id}-vpc-hint`, className: "qoder-cn-card__hint", children: t("vpcHint") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { className: "qoder-cn-card__advanced", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: t("advanced") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "qoder-cn-card__form", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "qoder-cn-card__field", htmlFor: `${id}-gateway`, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("gateway") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                id: `${id}-gateway`,
                type: "url",
                autoComplete: "off",
                spellCheck: false,
                value: draft.baseURL,
                disabled: busy || readOnly,
                "aria-describedby": `${id}-endpoint-hint`,
                onChange: (event) => {
                  setDraft({ ...draft, baseURL: event.target.value });
                }
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "qoder-cn-card__field", htmlFor: `${id}-openapi`, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("openApi") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                id: `${id}-openapi`,
                type: "url",
                autoComplete: "off",
                spellCheck: false,
                value: draft.openApiUrl,
                disabled: busy || readOnly,
                "aria-describedby": `${id}-endpoint-hint`,
                onChange: (event) => {
                  setDraft({ ...draft, openApiUrl: event.target.value });
                }
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { id: `${id}-endpoint-hint`, className: "qoder-cn-card__hint", children: t("endpointHint") })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "qoder-cn-card__feedback", "aria-live": "polite", children: [
        failure && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "qoder-cn-card__error", role: "alert", children: t(failure) }),
        partial && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "qoder-cn-card__hint", children: t("partial") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", { className: "qoder-cn-card__actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", disabled: busy, onClick: () => {
          setDraft(void 0);
          setFailure(void 0);
          setPartial(false);
        }, children: t(partial ? "close" : "cancel") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "primary", type: "submit", disabled: busy || readOnly || failure === "conflict" || !!draft.pat.trim() && !info?.writable, children: t(busy ? "saving" : "save") })
      ] })
    ] })
  ] });
}

// src/client/locales.ts
var en = {
  title: "Qoder CN",
  intro: "Connect with a personal access token. Leave the VPC instance empty to use the public service.",
  configured: "PAT configured",
  missing: "PAT not configured",
  unknown: "PAT status unavailable",
  edit: "Edit connection",
  cancel: "Cancel",
  close: "Close",
  save: "Save",
  saving: "Saving\u2026",
  pat: "Personal access token (PAT)",
  patHint: "Leave empty to keep the existing token. Stored tokens are never displayed.",
  vpc: "VPC instance (optional)",
  vpcHint: "Enter the instance ID, not a workspace URL. Clear it to use the public service.",
  advanced: "Advanced endpoint overrides",
  gateway: "Gateway URL (optional)",
  openApi: "OpenAPI URL (optional)",
  endpointHint: "Leave empty to derive the endpoints from the VPC instance or public service.",
  readOnly: "Connection settings are read-only in this session. Open the local Host to edit them.",
  credentialReadOnly: "This token is managed by a read-only credential source, such as the launch environment. Update it there instead.",
  loadFailed: "Could not read the token status. Retry before saving a new token.",
  credentialFailed: "The token could not be saved. Your input is kept; retry or check the credential source.",
  settingsFailed: "The connection could not be saved. Your input is kept; check the values and retry.",
  conflict: "These settings changed elsewhere. Cancel and reopen this editor to load the latest values; your draft has not been discarded.",
  partial: "Connection settings were saved, but the token was not. Closing will not undo the saved settings.",
  unavailable: "Qoder connection settings are unavailable. Enable the llm-qoder plugin entry on the Host.",
  retry: "Retry",
  public: "Public service"
};
var zh = {
  title: "Qoder CN",
  intro: "\u4F7F\u7528\u4E2A\u4EBA\u8BBF\u95EE\u4EE4\u724C\u8FDE\u63A5\u3002VPC \u5B9E\u4F8B\u7559\u7A7A\u65F6\u4F7F\u7528\u516C\u7F51\u670D\u52A1",
  configured: "PAT \u5DF2\u914D\u7F6E",
  missing: "PAT \u672A\u914D\u7F6E",
  unknown: "PAT \u72B6\u6001\u4E0D\u53EF\u7528",
  edit: "\u7F16\u8F91\u8FDE\u63A5",
  cancel: "\u53D6\u6D88",
  close: "\u5173\u95ED",
  save: "\u4FDD\u5B58",
  saving: "\u6B63\u5728\u4FDD\u5B58\u2026",
  pat: "\u4E2A\u4EBA\u8BBF\u95EE\u4EE4\u724C\uFF08PAT\uFF09",
  patHint: "\u7559\u7A7A\u4FDD\u7559\u73B0\u6709\u4EE4\u724C\uFF0C\u5DF2\u4FDD\u5B58\u7684\u4EE4\u724C\u4E0D\u4F1A\u56DE\u663E",
  vpc: "VPC \u5B9E\u4F8B\uFF08\u53EF\u9009\uFF09",
  vpcHint: "\u586B\u5199\u5B9E\u4F8B ID\uFF0C\u800C\u4E0D\u662F\u5DE5\u4F5C\u533A\u7F51\u5740\uFF1B\u6E05\u7A7A\u540E\u4F7F\u7528\u516C\u7F51\u670D\u52A1",
  advanced: "\u9AD8\u7EA7\u7AEF\u70B9\u8986\u76D6",
  gateway: "Gateway URL\uFF08\u53EF\u9009\uFF09",
  openApi: "OpenAPI URL\uFF08\u53EF\u9009\uFF09",
  endpointHint: "\u7559\u7A7A\u65F6\u6839\u636E VPC \u5B9E\u4F8B\u6216\u516C\u7F51\u670D\u52A1\u81EA\u52A8\u751F\u6210\u7AEF\u70B9",
  readOnly: "\u5F53\u524D\u4F1A\u8BDD\u7684\u8FDE\u63A5\u8BBE\u7F6E\u4E3A\u53EA\u8BFB\uFF0C\u8BF7\u5728\u672C\u673A Host \u4E2D\u7F16\u8F91",
  credentialReadOnly: "\u6B64\u4EE4\u724C\u7531\u542F\u52A8\u73AF\u5883\u7B49\u53EA\u8BFB\u51ED\u636E\u6765\u6E90\u7BA1\u7406\uFF0C\u8BF7\u5230\u5BF9\u5E94\u6765\u6E90\u4E2D\u4FEE\u6539",
  loadFailed: "\u65E0\u6CD5\u8BFB\u53D6\u4EE4\u724C\u72B6\u6001\uFF0C\u8BF7\u91CD\u8BD5\u540E\u518D\u4FDD\u5B58\u65B0\u4EE4\u724C",
  credentialFailed: "\u4EE4\u724C\u4FDD\u5B58\u5931\u8D25\uFF0C\u8F93\u5165\u5DF2\u4FDD\u7559\uFF1B\u8BF7\u91CD\u8BD5\u6216\u68C0\u67E5\u51ED\u636E\u6765\u6E90",
  settingsFailed: "\u8FDE\u63A5\u4FDD\u5B58\u5931\u8D25\uFF0C\u8F93\u5165\u5DF2\u4FDD\u7559\uFF1B\u8BF7\u68C0\u67E5\u586B\u5199\u5185\u5BB9\u540E\u91CD\u8BD5",
  conflict: "\u8FD9\u4E9B\u8BBE\u7F6E\u5DF2\u5728\u5176\u4ED6\u5730\u65B9\u4FEE\u6539\u3002\u8BF7\u53D6\u6D88\u5E76\u91CD\u65B0\u6253\u5F00\u7F16\u8F91\u5668\u4EE5\u52A0\u8F7D\u6700\u65B0\u503C\uFF0C\u5F53\u524D\u8349\u7A3F\u5C1A\u672A\u4E22\u5F03",
  partial: "\u8FDE\u63A5\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\uFF0C\u4F46\u4EE4\u724C\u672A\u4FDD\u5B58\uFF1B\u5173\u95ED\u7F16\u8F91\u5668\u4E0D\u4F1A\u64A4\u9500\u5DF2\u4FDD\u5B58\u7684\u8BBE\u7F6E",
  unavailable: "Qoder \u8FDE\u63A5\u8BBE\u7F6E\u4E0D\u53EF\u7528\uFF0C\u8BF7\u5728 Host \u4E0A\u542F\u7528 llm-qoder \u63D2\u4EF6\u6761\u76EE",
  retry: "\u91CD\u8BD5",
  public: "\u516C\u7F51\u670D\u52A1"
};

// src/client/card.css
var card_default = ".qoder-cn-card {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  min-width: 0;\n  padding: 12px 14px;\n  border: 0.5px solid var(--dsw-alias-settings-card-stroke);\n  border-radius: var(--dsw-radius-xl);\n  background: var(--dsw-alias-settings-card-fill);\n  color: var(--dsw-alias-label-primary);\n  font-size: 14px;\n  line-height: 22px;\n}\n\n.qoder-cn-card__header,\n.qoder-cn-card__actions,\n.qoder-cn-card__notice {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 8px;\n}\n\n.qoder-cn-card__header h3 {\n  margin: 0;\n  font-size: 14px;\n  line-height: 22px;\n  font-weight: 500;\n}\n\n.qoder-cn-card__header > button {\n  margin-left: auto;\n}\n\n.qoder-cn-card__status,\n.qoder-cn-card__hint {\n  margin: 0;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n  line-height: 18px;\n  overflow-wrap: anywhere;\n}\n\n.qoder-cn-card__form,\n.qoder-cn-card__field {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  min-width: 0;\n}\n\n.qoder-cn-card__field {\n  gap: 6px;\n}\n\n.qoder-cn-card__field input {\n  box-sizing: border-box;\n  width: 100%;\n  min-width: 0;\n  height: 36px;\n  padding: 0 10px;\n  border: 0.5px solid var(--dsw-alias-border-l3);\n  border-radius: var(--dsw-radius-md);\n  background: var(--dsw-alias-settings-card-fill);\n  color: var(--dsw-alias-label-primary);\n  font: inherit;\n}\n\n.qoder-cn-card__field input:focus-visible,\n.qoder-cn-card__advanced summary:focus-visible {\n  outline: 2px solid var(--dsw-alias-button-primary-fill);\n  outline-offset: 2px;\n}\n\n.qoder-cn-card__field input:disabled {\n  cursor: not-allowed;\n}\n\n.qoder-cn-card__advanced summary {\n  cursor: pointer;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.qoder-cn-card__advanced[open] summary {\n  margin-bottom: 12px;\n}\n\n.qoder-cn-card__feedback {\n  min-height: 18px;\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n\n.qoder-cn-card__error,\n.qoder-cn-card__notice {\n  margin: 0;\n  color: var(--dsw-alias-state-error-primary);\n  font-size: 12px;\n  line-height: 18px;\n  overflow-wrap: anywhere;\n}\n\n.qoder-cn-card__actions {\n  justify-content: flex-end;\n}\n";

// src/client/index.ts
var localeNamespace = "settings.qoderCn";
var inject = ["slots", "locale", "configForms", "remote", "remote.settings", "remote.credentials"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(localeNamespace, { en, zh }), "qoder-cn: card locales");
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = "@lightmanlu/dsh-provider-qoder";
    style.textContent = card_default;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, "qoder-cn: card styles");
  const form = ctx.configForms.get(settingsNamespace);
  const operations = {
    describe: async (ref) => {
      const response = await ctx.remote.credentials.describe([ref]);
      return response.ok ? response.value[ref] : void 0;
    },
    mutate: (ops, revision) => ctx.remote.settings.mutate(settingsNamespace, ops, revision),
    store: async (ref, pat) => {
      const response = await ctx.remote.credentials.set(ref, pat);
      return response.ok;
    },
    subscribeCredentials: (listener) => {
      const disposers = [
        ctx.remote.$on("credentials/reference-updated", listener),
        ctx.remote.$on("credentials/record-updated", listener),
        ctx.on("connection/reset", listener)
      ];
      return () => {
        for (const dispose of disposers) dispose();
      };
    }
  };
  ctx.slots.inject("settings.models.footer", () => ctx.slots.register({
    name: "settings.models.footer",
    id: "qoder-cn-connection",
    order: 20,
    locale: localeNamespace,
    inject: () => ({ form, operations })
  }, QoderCard));
}
return module.exports; } });
