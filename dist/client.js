window.__ModuleLoader__.load({ id: "dsh-provider-qoder", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
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
var import_jsx_runtime = require("react/jsx-runtime");
var cardStyle = {
  listStyle: "none",
  border: "1px solid var(--dsw-alias-border-subtle, #d0d0d0)",
  borderRadius: 8,
  padding: 0,
  margin: "0 0 12px",
  overflow: "hidden"
};
var headerStyle = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  width: "100%",
  padding: "12px 16px",
  border: 0,
  background: "transparent",
  cursor: "pointer",
  textAlign: "left"
};
var nameStyle = { fontWeight: 600, display: "block" };
var descStyle = { opacity: 0.7, fontSize: 13, display: "block" };
var bodyStyle = { padding: "0 16px 16px", display: "grid", gap: 12 };
var labelStyle = { fontSize: 13, fontWeight: 500 };
var inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--dsw-alias-border-subtle, #d0d0d0)"
};
var hintStyle = { fontSize: 12, opacity: 0.7, margin: 0 };
var footerStyle = { display: "flex", gap: 8, justifyContent: "flex-end" };
function QoderCard(props) {
  const { t } = props;
  const state = props.useQoderCard((snapshot) => snapshot);
  const [open, setOpen] = (0, import_react.useState)(true);
  if (!state.available) return null;
  const title = t("title");
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { style: cardStyle, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "button",
      {
        type: "button",
        style: headerStyle,
        "aria-expanded": open,
        "aria-label": `${t(open ? "collapse" : "expand")}: ${title}`,
        onClick: () => {
          setOpen(!open);
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: nameStyle, children: title }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: descStyle, children: t("description") })
          ] }),
          state.dirty ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { marginLeft: "auto", fontSize: 12 }, children: t("unsaved") }) : null
        ]
      }
    ),
    open ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: bodyStyle, children: [
      !state.writable ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", children: t("readOnly") }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: labelStyle, htmlFor: "qoder-pat", children: t("pat") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            id: "qoder-pat",
            style: inputStyle,
            type: "password",
            autoComplete: "off",
            value: state.pat,
            disabled: !state.patWritable,
            placeholder: state.patConfigured ? t("patSet") : t("patUnset"),
            onChange: (event) => {
              props.editPat(event.target.value);
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: hintStyle, children: t("patHint") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { style: labelStyle, htmlFor: "qoder-vpc", children: t("vpc") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            id: "qoder-vpc",
            style: inputStyle,
            type: "text",
            autoComplete: "off",
            value: state.vpc,
            disabled: !state.writable,
            onChange: (event) => {
              props.editVpc(event.target.value);
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: hintStyle, children: t("vpcHint") })
      ] }),
      state.failed ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "status", children: t("saveFailed") }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: footerStyle, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: !state.dirty || state.saving, onClick: props.discard, children: t("discard") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            disabled: !state.dirty || state.saving || !state.writable && state.pat.trim().length === 0,
            onClick: props.save,
            children: state.saving ? t("saving") : t("save")
          }
        )
      ] })
    ] }) : null
  ] });
}

// src/client/controller.ts
var import_client = require("@deepseek-ai/dsh-client-runtime/client");
var QODER_NS = "llm-qoder";
var DEFAULT_API_KEY_REF = "QODERCN_PERSONAL_ACCESS_TOKEN";
var QoderCardController = class {
  /**
   * @param scope - bound `llm-qoder` settings scope.
   * @param api - credentials wire face.
   */
  constructor(scope, api) {
    this.scope = scope;
    this.api = api;
    this.store = (0, import_client.createSnapshotStore)(this.projection());
    scope.subscribe(() => {
      void this.readCredential();
      this.publish();
    });
    void this.readCredential();
  }
  scope;
  api;
  patDraft = "";
  vpcDraft;
  vpcClear = false;
  saving = false;
  failed = false;
  credential = { ref: "", configured: false, writable: true };
  store;
  /** Re-read after another surface writes the same credential reference. */
  refreshCredential(ref) {
    if (ref !== this.credential.ref) return;
    void this.readCredential();
  }
  /** Slot inject face. */
  inject() {
    return {
      hooks: { qoderCard: this.store },
      editPat: (text) => {
        this.patDraft = text;
        this.publish();
      },
      editVpc: (text) => {
        this.vpcDraft = text;
        this.vpcClear = text.trim().length === 0;
        this.publish();
      },
      resetVpc: () => {
        this.vpcDraft = "";
        this.vpcClear = true;
        this.publish();
      },
      save: () => {
        void this.save();
      },
      discard: () => {
        this.patDraft = "";
        this.vpcDraft = void 0;
        this.vpcClear = false;
        this.failed = false;
        this.publish();
      }
    };
  }
  projection() {
    const snapshot = this.scope.getSnapshot();
    return {
      available: snapshot.status === "ready",
      writable: snapshot.writable,
      dirty: this.dirty(snapshot),
      saving: this.saving,
      failed: this.failed,
      pat: this.patDraft,
      patConfigured: this.credential.configured,
      patWritable: this.credential.writable,
      vpc: this.vpcDraft !== void 0 ? this.vpcDraft : stringOf(snapshot.value?.vpcInstance),
      vpcOverridden: this.vpcClear || hasUserField(snapshot.user, "vpcInstance")
    };
  }
  dirty(snapshot) {
    if (this.patDraft.trim().length > 0) return true;
    if (this.vpcClear) return hasUserField(snapshot.user, "vpcInstance");
    if (this.vpcDraft === void 0) return false;
    return this.vpcDraft.trim() !== stringOf(snapshot.value?.vpcInstance);
  }
  publish() {
    this.store.set(this.projection());
  }
  async readCredential() {
    const ref = refOf(this.scope.getSnapshot());
    if (ref !== this.credential.ref) {
      this.credential = { ref, configured: false, writable: true };
      this.publish();
    }
    let response;
    try {
      response = await this.api.credentials.describe({ refs: [ref] });
    } catch {
      return;
    }
    if (!response.result.ok || ref !== refOf(this.scope.getSnapshot())) return;
    const view = response.result.value.credentials[ref];
    this.credential = {
      ref,
      configured: view?.configured ?? false,
      writable: view?.writable ?? true
    };
    this.publish();
  }
  async save() {
    if (this.saving) return;
    this.saving = true;
    this.failed = false;
    this.publish();
    try {
      const snapshot = this.scope.getSnapshot();
      if (this.patDraft.trim().length > 0) {
        const stored = await this.api.credentials.set({
          ref: refOf(snapshot),
          value: this.patDraft.trim()
        });
        if (!stored.result.ok) throw new Error(stored.result.error.message);
        this.patDraft = "";
        await this.readCredential();
      }
      if (this.vpcClear) {
        await this.scope.unset("vpcInstance");
      } else if (this.vpcDraft !== void 0 && this.vpcDraft.trim().length > 0) {
        await this.scope.set("vpcInstance", this.vpcDraft.trim());
      }
      this.vpcDraft = void 0;
      this.vpcClear = false;
    } catch {
      this.failed = true;
    } finally {
      this.saving = false;
      this.publish();
    }
  }
};
function stringOf(value) {
  return typeof value === "string" ? value : "";
}
function hasUserField(user, field) {
  return typeof user === "object" && user !== null && field in user;
}
function refOf(snapshot) {
  const declared = snapshot.value?.apiKeyEnv;
  return declared !== void 0 && declared.length > 0 ? declared : DEFAULT_API_KEY_REF;
}

// src/client/locales.ts
var en = {
  title: "qoder-cn",
  description: "Qoder CN PAT and optional enterprise VPC.",
  pat: "Personal access token",
  patHint: "A Qoder PAT starting with pt-. Leave blank to keep the stored token.",
  patSet: "Configured",
  patUnset: "Not configured",
  vpc: "VPC instance",
  vpcHint: "Optional. Enterprise host such as tenant.vpc.qoder.com.cn. Leave blank for public cloud.",
  save: "Save",
  saving: "Saving\u2026",
  discard: "Discard",
  unsaved: "Unsaved",
  saveFailed: "The deployment did not accept these values; they were left for you to correct.",
  readOnly: "This deployment stores settings read-only.",
  expand: "Show settings",
  collapse: "Hide settings"
};
var zh = {
  title: "qoder-cn",
  description: "Qoder CN \u4E2A\u4EBA\u8BBF\u95EE\u4EE4\u724C\uFF0C\u4EE5\u53CA\u53EF\u9009\u7684\u4F01\u4E1A VPC\u3002",
  pat: "\u4E2A\u4EBA\u8BBF\u95EE\u4EE4\u724C",
  patHint: "\u4EE5 pt- \u5F00\u5934\u7684 Qoder PAT\u3002\u7559\u7A7A\u5219\u4FDD\u7559\u5DF2\u4FDD\u5B58\u7684\u4EE4\u724C\u3002",
  patSet: "\u5DF2\u914D\u7F6E",
  patUnset: "\u672A\u914D\u7F6E",
  vpc: "VPC \u5B9E\u4F8B",
  vpcHint: "\u53EF\u9009\u3002\u4F01\u4E1A\u4E3B\u673A\uFF0C\u4F8B\u5982 tenant.vpc.qoder.com.cn\u3002\u7559\u7A7A\u4F7F\u7528\u516C\u6709\u4E91\u3002",
  save: "\u4FDD\u5B58",
  saving: "\u4FDD\u5B58\u4E2D\u2026",
  discard: "\u653E\u5F03",
  unsaved: "\u672A\u4FDD\u5B58",
  saveFailed: "\u90E8\u7F72\u672A\u63A5\u53D7\u8FD9\u4E9B\u503C\uFF0C\u5DF2\u7559\u7ED9\u4F60\u4FEE\u6539\u3002",
  readOnly: "\u6B64\u90E8\u7F72\u7684\u8BBE\u7F6E\u4E3A\u53EA\u8BFB\u3002",
  expand: "\u663E\u793A\u8BBE\u7F6E",
  collapse: "\u9690\u85CF\u8BBE\u7F6E"
};

// src/client/index.ts
var inject = ["slots", "locale", "connection", "remote", "settingsScope"];
var LOCALE = "settings.qoder";
function apply(ctx) {
  const { api } = ctx.get("connection");
  ctx.effect(() => ctx.locale.register(LOCALE, { zh, en }), "dsh-provider-qoder: card dictionaries");
  const card = new QoderCardController(ctx.settingsScope.bind({ namespace: QODER_NS }), api);
  ctx.effect(
    () => ctx.remote.$on("credentials/updated", (ref) => {
      card.refreshCredential(ref);
    }),
    "dsh-provider-qoder: credential invalidations"
  );
  ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
    name: "settings.plugin.item",
    key: QODER_NS,
    locale: LOCALE,
    inject: () => card.inject()
  }, QoderCard));
}
return module.exports;
}});
