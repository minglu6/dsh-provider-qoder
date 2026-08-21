var __knownSymbol = (name2, symbol) => (symbol = Symbol[name2]) ? symbol : /* @__PURE__ */ Symbol.for("Symbol." + name2);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __using = (stack, value, async) => {
  if (value != null) {
    if (typeof value !== "object" && typeof value !== "function") __typeError("Object expected");
    var dispose, inner;
    if (async) dispose = value[__knownSymbol("asyncDispose")];
    if (dispose === void 0) {
      dispose = value[__knownSymbol("dispose")];
      if (async) inner = dispose;
    }
    if (typeof dispose !== "function") __typeError("Object not disposable");
    if (inner) dispose = function() {
      try {
        inner.call(this);
      } catch (e) {
        return Promise.reject(e);
      }
    };
    stack.push([async, dispose, value]);
  } else if (async) {
    stack.push([async]);
  }
  return value;
};
var __callDispose = (stack, error, hasError) => {
  var E = typeof SuppressedError === "function" ? SuppressedError : function(e, s, m, _) {
    return _ = Error(m), _.name = "SuppressedError", _.error = e, _.suppressed = s, _;
  };
  var fail = (e) => error = hasError ? new E(e, error, "An error was suppressed during disposal") : (hasError = true, e);
  var next = (it) => {
    while (it = stack.pop()) {
      try {
        var result = it[1] && it[1].call(it[2]);
        if (it[0]) return Promise.resolve(result).then(next, (e) => (fail(e), next()));
      } catch (e) {
        fail(e);
      }
    }
    if (hasError) throw error;
  };
  return next();
};

// src/index.ts
import z from "@deepseek-ai/schemastery";
import { assertUsableApiKey, LlmError as LlmError5, resolveRetryPolicy, RetryPolicySchema } from "@deepseek-ai/dsh-llm";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import { deepEqualJson, installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";

// src/adapter.ts
import crypto2 from "node:crypto";
import { attributionHeaders, CONTEXT_WINDOW_EXCEEDED_CODE, isContextWindowExceededError, isQuotaExceededError, LlmAdapter, LlmError as LlmError4, QUOTA_EXCEEDED_CODE, ReasoningEffortId } from "@deepseek-ai/dsh-llm";
import { idleWatchdog, timeoutOf } from "@deepseek-ai/dsh-timeout";

// src/cosy.ts
import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
var qoderRSAPublicKey = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`;
var QoderIDEVersion = "1.0.0";
var QoderClientType = "5";
var QoderDataPolicy = "disagree";
var QoderLoginVersion = "v2";
var QoderMachineOS = "x86_64_windows";
var QoderMachineTypeMagic = "5";
var QoderVPCDomain = "vpc.qoder.com.cn";
function isQoderPatValue(value) {
  return Boolean(value?.trim().startsWith("pt-"));
}
function parseQoderVPCInstance(value) {
  if (!value?.trim()) return void 0;
  let candidate = value.trim().toLowerCase();
  try {
    candidate = new URL(candidate.includes("://") ? candidate : `https://${candidate}`).hostname;
  } catch {
    return void 0;
  }
  const suffix = `.${QoderVPCDomain}`;
  if (candidate.endsWith(suffix)) {
    candidate = candidate.slice(0, -suffix.length);
    if (candidate.endsWith("-gateway") || candidate.endsWith("-openapi")) {
      candidate = candidate.slice(0, -8);
    }
  } else if (candidate.includes(".")) {
    return void 0;
  }
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(candidate) ? candidate : void 0;
}
function qoderCnEndpoints(vpcInstance) {
  if (vpcInstance !== void 0 && vpcInstance.length > 0) {
    return {
      gateway: `https://${vpcInstance}-gateway.${QoderVPCDomain}`,
      openapi: `https://${vpcInstance}-openapi.${QoderVPCDomain}`,
      manage: `https://${vpcInstance}.${QoderVPCDomain}`
    };
  }
  return {
    gateway: "https://gateway.qoder.com.cn",
    openapi: "https://openapi.qoder.com.cn",
    manage: "https://qoder.com.cn"
  };
}
function qoderChatUrl(endpoints) {
  return `${endpoints.gateway}/algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1`;
}
function qoderModelListUrl(endpoints) {
  return `${endpoints.gateway}/algo/api/v2/model/list`;
}
function getQoderCNDirectModel(modelID) {
  return {
    "qoder-cn": "auto",
    "qwen3.7-max": "qmodel_latest",
    "qwen3.7-plus": "qmodel",
    "qwen3.6-plus": "qmodel",
    "qwen3.6-flash": "q36fmodel",
    "deepseek-v4-pro": "dmodel",
    "deepseek-v4-flash": "dfmodel",
    "glm-5.2": "gm51model",
    "glm-5.1": "gm51model",
    "kimi-k2.6": "kmodel",
    "minimax-m2.7": "mmodel",
    "minimax-m3": "mmodel"
  }[modelID || ""] || modelID || "auto";
}
var qoderCNFriendlyModels = {
  auto: { id: "auto", name: "Auto" },
  "qoder-cn": { id: "qoder-cn", name: "Auto" },
  qmodel_latest: { id: "qwen3.7-max", name: "Qwen 3.7 Max" },
  qmodel: { id: "qwen3.7-plus", name: "Qwen 3.7 Plus" },
  q36fmodel: { id: "qwen3.6-flash", name: "Qwen 3.6 Flash" },
  qfmodel: { id: "qwen3.6-flash", name: "Qwen 3.6 Flash" },
  dmodel: { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  dfmodel: { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  gm51model: { id: "glm-5.2", name: "GLM 5.2" },
  kmodel: { id: "kimi-k2.6", name: "Kimi K2.6" },
  mmodel: { id: "minimax-m2.7", name: "MiniMax M2.7" }
};
function prettifyQoderCNModelName(name2) {
  return (name2 || "Model").replace(/\s*·\s*Qoder CN\s*$/i, "").replace(/Qwen(\d)/g, "Qwen $1").replace(/Qwen([\d.]+)-/g, "Qwen $1 ").replace(/DeepSeek\s*V(\d)-/g, "DeepSeek V$1 ").replace(/\s+/g, " ").trim();
}
function getQoderCNFriendlyModelInfo(key, display) {
  return qoderCNFriendlyModels[key] ?? {
    id: key,
    name: prettifyQoderCNModelName(display ?? key)
  };
}
function rsaEncryptBase64(data) {
  const encrypted = crypto.publicEncrypt(
    { key: qoderRSAPublicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(data)
  );
  return encrypted.toString("base64");
}
function aesEncryptCBCBase64(plaintext, keyStr) {
  const cipher = crypto.createCipheriv("aes-128-cbc", Buffer.from(keyStr), Buffer.from(keyStr));
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  return encrypted;
}
function computeSigPath(urlStr) {
  const parsed = new URL(urlStr);
  let sigPath = parsed.pathname;
  if (sigPath.startsWith("/algo")) {
    sigPath = sigPath.substring("/algo".length);
  }
  return sigPath;
}
function getMachineId(dshHome) {
  const paths = [
    join(homedir(), ".qoder", ".auth", "machine_id"),
    join(homedir(), ".pi", "agent", "qoder-machine-id"),
    join(dshHome, "qoder-machine-id")
  ];
  for (const p of paths.slice(0, 2)) {
    if (existsSync(p)) {
      try {
        const val = readFileSync(p, "utf8").trim();
        if (val) return val;
      } catch {
      }
    }
  }
  const newId = crypto.randomUUID();
  try {
    const savePath = paths[2];
    mkdirSync(dirname(savePath), { recursive: true });
    writeFileSync(savePath, newId, "utf8");
  } catch {
  }
  return newId;
}
function buildQoderAuthHeaders(body, requestURL, creds) {
  if (!creds.userID) {
    throw new Error("cosy: user id is empty");
  }
  if (!creds.authToken) {
    throw new Error("cosy: auth token is empty");
  }
  const aesKey = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const userInfo = {
    uid: creds.userID,
    security_oauth_token: creds.authToken,
    name: creds.name || "",
    aid: "",
    email: creds.email || ""
  };
  const infoB64 = aesEncryptCBCBase64(JSON.stringify(userInfo), aesKey);
  const cosyKey = rsaEncryptBase64(aesKey);
  const timestamp = Math.floor(Date.now() / 1e3).toString();
  const requestId = crypto.randomUUID();
  const cosyPayload = {
    version: "v1",
    requestId,
    info: infoB64,
    cosyVersion: QoderIDEVersion,
    ideVersion: ""
  };
  const payloadB64 = Buffer.from(JSON.stringify(cosyPayload)).toString("base64");
  const sigPath = computeSigPath(requestURL);
  const bodyStr = body ? Buffer.isBuffer(body) ? body.toString("utf8") : body : "";
  const sigInput = `${payloadB64}
${cosyKey}
${timestamp}
${bodyStr}
${sigPath}`;
  const sig = crypto.createHash("md5").update(sigInput).digest("hex");
  const bodyHash = crypto.createHash("md5").update(body || "").digest("hex");
  const bodyLen = body ? (Buffer.isBuffer(body) ? body.length : Buffer.from(body).length).toString() : "0";
  const machineID = creds.machineID || getMachineId(process.env.DSH_HOME || join(homedir(), ".dsh"));
  return {
    Authorization: `Bearer COSY.${payloadB64}.${sig}`,
    "Cosy-Key": cosyKey,
    "Cosy-User": creds.userID,
    "Cosy-Date": timestamp,
    "Cosy-Version": QoderIDEVersion,
    "Cosy-Machineid": machineID,
    "Cosy-Machinetoken": machineID,
    "Cosy-Machinetype": QoderMachineTypeMagic,
    "Cosy-Machineos": QoderMachineOS,
    "Cosy-Clienttype": QoderClientType,
    "Cosy-Clientip": "127.0.0.1",
    "Cosy-Bodyhash": bodyHash,
    "Cosy-Bodylength": bodyLen,
    "Cosy-Sigpath": sigPath,
    "Cosy-Data-Policy": QoderDataPolicy,
    "Cosy-Organization-Id": "",
    "Cosy-Organization-Tags": "",
    "Login-Version": QoderLoginVersion,
    "X-Request-Id": crypto.randomUUID()
  };
}
function parseVpcInstanceFromEnvironment(get) {
  return parseQoderVPCInstance(
    get("QODER_VPC_INSTANCE")?.value ?? get("QODER_VPC_ENDPOINT")?.value ?? get("QODERCN_VPC_ENDPOINT")?.value ?? get("QODERCN_CLI_VPC_ENDPOINT")?.value ?? get("QODER_CN_BASE_URL")?.value ?? get("QODER_CN_OPENAPI_URL")?.value ?? get("QODER_CN_CENTER_URL")?.value
  );
}

// src/qoder-encoding.ts
var qoderCustomAlphabet = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!";
var qoderStdAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function qoderEncodeBody(plaintext) {
  const std = Buffer.isBuffer(plaintext) ? plaintext.toString("base64") : Buffer.from(plaintext).toString("base64");
  const n = std.length;
  const a = Math.floor(n / 3);
  const rearranged = std.slice(n - a) + std.slice(a, n - a) + std.slice(0, a);
  let out = "";
  for (let i = 0; i < n; i++) {
    const c = rearranged[i];
    if (c === "=") {
      out += "$";
    } else {
      const idx = qoderStdAlphabet.indexOf(c);
      out += idx >= 0 ? qoderCustomAlphabet[idx] : c;
    }
  }
  return out;
}

// src/pat.ts
var UA = "dsh-llm-qoder";
function parseExpiry(data) {
  if (data.expires_at) {
    const parsed = Date.parse(data.expires_at);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (data.expires_in) {
    return Date.now() + data.expires_in;
  }
  return Date.now() + 24 * 60 * 60 * 1e3;
}
async function exchangeJobToken(pat, endpoints, signal) {
  const res = await fetch(`${endpoints.openapi}/api/v1/jobToken/exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": UA,
      "Cosy-Version": "1.0.1",
      "Cosy-ClientType": "5"
    },
    body: JSON.stringify({ personal_token: pat }),
    signal
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Qoder CN PAT exchange failed: ${res.status} ${res.statusText}. Response: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.token) {
    throw new Error("Qoder CN PAT exchange returned no job token");
  }
  return {
    jobToken: data.token,
    jobRefreshToken: data.refresh_token || "",
    expiresAt: parseExpiry(data)
  };
}
async function refreshJobToken(jobRefreshToken, endpoints, signal) {
  if (jobRefreshToken.trim().length === 0) {
    throw new Error("Qoder CN job token refresh requires a non-empty refresh_token (jrt-...)");
  }
  const res = await fetch(`${endpoints.openapi}/api/v1/jobToken/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": UA,
      "Cosy-Version": "1.0.1",
      "Cosy-ClientType": "5"
    },
    body: JSON.stringify({ refresh_token: jobRefreshToken }),
    signal
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Qoder CN job token refresh failed: ${res.status} ${res.statusText}. Response: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.token) {
    throw new Error("Qoder CN job token refresh returned no job token");
  }
  return {
    jobToken: data.token,
    jobRefreshToken: data.refresh_token || jobRefreshToken,
    expiresAt: parseExpiry(data)
  };
}
async function fetchUserInfo(jobToken, endpoints, signal) {
  let userID = "";
  let email = "";
  let name2 = "";
  try {
    const res = await fetch(`${endpoints.openapi}/api/v1/userinfo`, {
      headers: {
        Authorization: `Bearer ${jobToken}`,
        Accept: "application/json",
        "User-Agent": UA,
        "Cosy-Version": "1.0.1",
        "Cosy-ClientType": "5"
      },
      signal
    });
    if (res.ok) {
      const info = await res.json();
      userID = info.id || "";
      email = info.email || "";
      name2 = info.name || info.username || "";
    }
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  return { userID, email, name: name2 };
}

// src/serialize.ts
import { contentHasImage, LlmError } from "@deepseek-ai/dsh-llm";
function getBlocksText(blocks) {
  return blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
}
function flattenBlocksText(blocks) {
  return blocks.map((block) => {
    if (block.type === "text") return block.text;
    if (block.type === "tool-result") return flattenBlocksText(block.content);
    return "";
  }).join("");
}
function transformTools(options) {
  return options.tools !== void 0 && options.tools.length > 0 ? options.tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  })) : void 0;
}
async function userContent(blocks, attachments) {
  if (!contentHasImage(blocks)) return flattenBlocksText(blocks);
  const content = [];
  for (const block of blocks) {
    switch (block.type) {
      case "text":
        if (block.text.length > 0) content.push({ type: "text", text: block.text });
        break;
      case "image": {
        if (attachments === void 0) {
          throw new LlmError(
            "Qoder CN image content requires the durable attachment service",
            "UNSUPPORTED_CONTENT"
          );
        }
        const stored = await attachments.readImage(block.attachment);
        content.push({
          type: "image_url",
          image_url: {
            url: `data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString("base64")}`
          }
        });
        break;
      }
      case "tool-result": {
        const nested = await userContent(block.content, attachments);
        if (typeof nested !== "string") content.push(...nested);
        else content.push({ type: "text", text: nested });
        break;
      }
      default:
        break;
    }
  }
  return content;
}
async function serializeMessages(options, attachments) {
  const normalizedMessages = [];
  for (const msg of options.messages) {
    if (msg.role === "user") {
      const regular = msg.content.filter((block) => block.type !== "tool-result");
      const content = await userContent(regular, attachments);
      const results = msg.content.filter((block) => block.type === "tool-result");
      if (content !== "" || results.length === 0) {
        normalizedMessages.push({ role: "user", content });
      }
      for (const result of results) {
        const resultContent = await userContent(result.content, attachments);
        normalizedMessages.push({
          role: "tool",
          tool_call_id: result.toolCallId,
          content: typeof resultContent === "string" ? resultContent || "(no output)" : resultContent
        });
      }
      continue;
    }
    if (msg.role === "assistant") {
      let content = "";
      const toolCalls = [];
      for (const block of msg.content) {
        if (block.type === "text") {
          content += block.text;
        } else if (block.type === "reasoning") {
          content += `<thinking>${block.text}</thinking>

`;
        } else if (block.type === "tool-call") {
          const call = {
            id: block.id,
            type: "function",
            function: {
              name: block.name,
              arguments: block.arguments
            }
          };
          toolCalls.push(call);
        }
      }
      const mapped = { role: "assistant", content: content || null };
      if (toolCalls.length > 0) {
        mapped.tool_calls = toolCalls;
      }
      normalizedMessages.push(mapped);
      continue;
    }
    const text = getBlocksText(msg.content);
    if (text.length > 0) normalizedMessages.push({ role: "user", content: text });
  }
  return normalizedMessages;
}
function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg !== void 0 && msg.role === "user") {
      return getBlocksText(msg.content.filter((block) => block.type !== "tool-result"));
    }
  }
  return "";
}

// src/sse.ts
import { LlmError as LlmError2 } from "@deepseek-ai/dsh-llm";
var DONE = "[DONE]";
function parseEnvelope(data) {
  try {
    const parsed = JSON.parse(data);
    const statusCodeValue = typeof parsed.statusCodeValue === "number" ? parsed.statusCodeValue : 200;
    return { statusCodeValue, body: parsed.body };
  } catch {
    throw new LlmError2(`malformed Qoder SSE envelope: ${data.slice(0, 120)}`, "MALFORMED_RESPONSE");
  }
}
async function* parseQoderSse(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawPayload = false;
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let lineEnd = buffer.indexOf("\n");
      while (lineEnd !== -1) {
        const line = buffer.slice(0, lineEnd).replace(/\r$/, "").trim();
        buffer = buffer.slice(lineEnd + 1);
        if (line.startsWith("data:")) {
          const payload = line.slice(5).trim();
          sawPayload = true;
          yield payload;
          if (payload === DONE) return;
        }
        lineEnd = buffer.indexOf("\n");
      }
    }
    const tail = buffer.replace(/\r$/, "").trim();
    if (tail.startsWith("data:")) {
      const payload = tail.slice(5).trim();
      sawPayload = true;
      yield payload;
      if (payload === DONE) return;
    }
  } finally {
    reader.releaseLock();
  }
  if (sawPayload) {
    yield DONE;
    return;
  }
  throw new LlmError2("Qoder SSE stream ended without [DONE]", "STREAM_CLOSED");
}

// src/translate.ts
import { CallId, EMPTY_RESPONSE_CODE, LlmError as LlmError3 } from "@deepseek-ai/dsh-llm";

// src/thinking-parser.ts
var THINKING_TAG_VARIANTS = [
  { open: "<thinking>", close: "</thinking>" },
  { open: " thinking", close: " response" },
  { open: "<reasoning>", close: "</reasoning>" },
  { open: "<thought>", close: "</thought>" }
];
function splitThinking(chunk) {
  const pieces = [];
  let cursor = 0;
  let currentKind = "text";
  let current = [];
  const flush = (kind) => {
    const text = current.join("");
    if (text.length > 0) pieces.push({ kind, text });
    current = [];
  };
  while (cursor < chunk.length) {
    let matched = false;
    for (const variant of THINKING_TAG_VARIANTS) {
      const open = currentKind === "text" ? variant.open : variant.close;
      if (chunk.startsWith(open, cursor)) {
        flush(currentKind);
        currentKind = currentKind === "text" ? "reasoning" : "text";
        cursor += open.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    current.push(chunk.charAt(cursor));
    cursor++;
  }
  flush(currentKind);
  return pieces;
}

// src/translate.ts
function mapFinishReason(reason) {
  switch (reason) {
    case "stop":
      return { kind: "stop" };
    case "tool_calls":
      return { kind: "tool-calls" };
    case "length":
      return { kind: "max-tokens" };
    default:
      return {
        kind: "error",
        failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() }
      };
  }
}
function mapUsage(usage) {
  return {
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0
  };
}
function closeBlock(block) {
  switch (block.kind) {
    case "text":
      return { type: "text", text: block.text };
    case "reasoning":
      return { type: "reasoning", text: block.text };
    case "tool-call":
      return {
        type: "tool-call",
        id: CallId(block.callId ?? ""),
        name: block.name ?? "",
        arguments: block.text
      };
  }
}
function parseInnerObject(body) {
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    return body;
  }
  return {};
}
async function* translate(envelopes, reasoningEnabled = true) {
  let nextIndex = 0;
  let textBlock;
  let reasoningBlock;
  const toolBlocks = /* @__PURE__ */ new Map();
  const order = [];
  let pendingFinish;
  let pendingUsage;
  const open = (kind) => {
    const block = { index: nextIndex++, kind, text: "" };
    order.push(block);
    return block;
  };
  for await (const item of envelopes) {
    if (item === DONE) {
      for (const block of order) {
        yield { type: "block-end", index: block.index, block: closeBlock(block) };
      }
      if (pendingUsage) yield { type: "usage", usage: pendingUsage };
      const reason = pendingFinish ?? { kind: "stop" };
      yield {
        type: "finish",
        reason: reason.kind === "stop" && order.length === 0 ? {
          kind: "error",
          failure: { message: "model returned a completed response with no content", code: EMPTY_RESPONSE_CODE }
        } : reason
      };
      return;
    }
    let envelope;
    if (typeof item === "string") {
      envelope = JSON.parse(item);
    } else {
      envelope = item;
    }
    if (envelope.statusCodeValue !== 200) {
      throw new LlmError3(
        `Qoder upstream status ${envelope.statusCodeValue}: ${String(envelope.body).slice(0, 200)}`,
        "UPSTREAM"
      );
    }
    let inner;
    if (typeof envelope.body === "string") {
      if (envelope.body === DONE) continue;
      try {
        inner = JSON.parse(envelope.body);
      } catch {
        throw new LlmError3(`malformed Qoder inner chunk: ${envelope.body.slice(0, 120)}`, "MALFORMED_RESPONSE");
      }
    } else {
      inner = parseInnerObject(envelope.body);
    }
    for (const choice of inner.choices ?? []) {
      const delta = choice.delta;
      const reasoning = delta?.reasoning_content;
      if (typeof reasoning === "string" && reasoning.length > 0) {
        if (!reasoningBlock) {
          reasoningBlock = open("reasoning");
          yield { type: "block-start", index: reasoningBlock.index, blockType: "reasoning" };
        }
        reasoningBlock.text += reasoning;
        yield { type: "reasoning-delta", index: reasoningBlock.index, text: reasoning };
      }
      const content = delta?.content;
      if (typeof content === "string" && content.length > 0) {
        if (reasoningEnabled) {
          const pieces = splitThinking(content);
          for (const piece of pieces) {
            if (piece.kind === "reasoning") {
              if (!reasoningBlock) {
                reasoningBlock = open("reasoning");
                yield { type: "block-start", index: reasoningBlock.index, blockType: "reasoning" };
              }
              reasoningBlock.text += piece.text;
              yield { type: "reasoning-delta", index: reasoningBlock.index, text: piece.text };
            } else {
              if (!textBlock) {
                textBlock = open("text");
                yield { type: "block-start", index: textBlock.index, blockType: "text" };
              }
              textBlock.text += piece.text;
              yield { type: "text-delta", index: textBlock.index, text: piece.text };
            }
          }
        } else {
          if (!textBlock) {
            textBlock = open("text");
            yield { type: "block-start", index: textBlock.index, blockType: "text" };
          }
          textBlock.text += content;
          yield { type: "text-delta", index: textBlock.index, text: content };
        }
      }
      for (const call of delta?.tool_calls ?? []) {
        const index = call.index ?? 0;
        let block = toolBlocks.get(index);
        if (!block) {
          block = open("tool-call");
          toolBlocks.set(index, block);
          yield { type: "block-start", index: block.index, blockType: "tool-call" };
        }
        if (call.id !== void 0) block.callId = call.id;
        if (call.function?.name !== void 0) block.name = call.function.name;
        const fragment = call.function?.arguments ?? "";
        block.text += fragment;
        yield {
          type: "tool-call-delta",
          index: block.index,
          id: CallId(block.callId ?? ""),
          ...block.name !== void 0 ? { name: block.name } : {},
          argumentsDelta: fragment
        };
      }
      if (typeof choice.finish_reason === "string") {
        pendingFinish = mapFinishReason(choice.finish_reason);
      }
    }
    if (inner.usage) pendingUsage = mapUsage(inner.usage);
  }
  throw new LlmError3("Qoder SSE payload stream ended without [DONE]", "STREAM_CLOSED");
}

// src/adapter.ts
var DEFAULT_STREAM_IDLE_TIMEOUT_MS = 3e5;
var DEFAULT_CONTEXT_WINDOW = 1e6;
var DEFAULT_MAX_TOKENS = 32768;
var STREAM_IDLE_TIMEOUT_CODE = "LLM_STREAM_IDLE_TIMEOUT";
var OFF_REASONING_EFFORT = ReasoningEffortId("off");
var HIGH_REASONING_EFFORT = ReasoningEffortId("high");
var MAX_REASONING_EFFORT = ReasoningEffortId("max");
var REASONING_EFFORTS = [
  { id: OFF_REASONING_EFFORT, name: "Off" },
  { id: HIGH_REASONING_EFFORT, name: "High" },
  { id: MAX_REASONING_EFFORT, name: "Max" }
];
var jobTokenCache = /* @__PURE__ */ new Map();
var identityCache = /* @__PURE__ */ new Map();
var modelCatalogCache = /* @__PURE__ */ new Map();
function hashCredential(value) {
  return crypto2.createHash("sha256").update(value).digest("hex");
}
function recordOf(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function positiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : void 0;
}
function contextWindowOf(entry) {
  const contexts = recordOf(entry.context_config);
  let listed;
  if (contexts !== void 0) {
    for (const value of Object.values(contexts)) {
      const context = recordOf(value);
      const tokenCount = positiveInteger(context?.token_count);
      if (tokenCount === void 0) continue;
      if (context?.is_default === true) return tokenCount;
      listed = listed === void 0 ? tokenCount : Math.max(listed, tokenCount);
    }
  }
  return positiveInteger(entry.max_input_tokens) ?? listed;
}
function parseQoderModelCatalog(value) {
  const root = recordOf(value);
  if (!Array.isArray(root?.chat)) {
    throw new LlmError4('Qoder CN model listing has no "chat" array', "DISCOVERY_FAILED");
  }
  const seen = /* @__PURE__ */ new Set();
  const models = [];
  for (const value2 of root.chat) {
    const entry = recordOf(value2);
    const key = typeof entry?.key === "string" ? entry.key.trim() : "";
    if (key.length === 0 || entry?.enable !== true) continue;
    const display = typeof entry.display_name === "string" && entry.display_name.trim().length > 0 ? entry.display_name.trim() : key;
    const identity = getQoderCNFriendlyModelInfo(key, display);
    if (seen.has(identity.id)) continue;
    seen.add(identity.id);
    const contextWindow = contextWindowOf(entry);
    const maxTokens = positiveInteger(entry.max_output_tokens);
    models.push({
      id: identity.id,
      name: identity.name,
      ...contextWindow === void 0 ? {} : { contextWindow },
      ...maxTokens === void 0 ? {} : { maxTokens },
      inputModalities: entry.is_vl === true ? ["text", "image"] : ["text"],
      reasoning: entry.is_reasoning === true || recordOf(entry.thinking_config) !== void 0
    });
  }
  if (models.length === 0) {
    throw new LlmError4("Qoder CN model listing contains no enabled usable models", "DISCOVERY_FAILED");
  }
  return models;
}
function httpErrorCode(status, detail) {
  if (status === 401 || status === 403) return "AUTH";
  if (isQuotaExceededError(detail)) return QUOTA_EXCEEDED_CODE;
  if (status === 429) return "RATE_LIMIT";
  if (status === 400) {
    if (isContextWindowExceededError(detail)) return CONTEXT_WINDOW_EXCEEDED_CODE;
    return "INVALID_REQUEST";
  }
  if (status >= 500) return "SERVER";
  return `HTTP_${status}`;
}
function modelInfo(provider, model) {
  return {
    provider,
    id: model.id,
    name: model.name ?? model.id,
    ...model.description === void 0 ? {} : { description: model.description },
    ...model.inputModalities === void 0 ? {} : { inputModalities: model.inputModalities }
  };
}
var QoderAdapter = class extends LlmAdapter {
  constructor(config) {
    super();
    this.config = config;
  }
  config;
  providerInfo(provider) {
    return { id: provider, name: provider };
  }
  providerRetryPolicy(_provider) {
    return this.config.options().retryPolicy;
  }
  async listModels(provider) {
    const models = await this.catalogModels(this.config.options(), true);
    return models.map((model) => modelInfo(provider, model));
  }
  async resolveModel(provider, model, signal) {
    const connection = this.config.options();
    const models = await this.catalogModels(connection, false, signal);
    const configured = models.find((entry) => entry.id === model);
    const contextWindow = configured?.contextWindow ?? connection.defaultContextWindow;
    const reasoning = configured?.reasoning === true;
    return {
      ...configured === void 0 ? { provider, id: model, name: model, inputModalities: ["text"] } : modelInfo(provider, configured),
      context: { contextWindow },
      defaultMaxTokens: configured?.maxTokens ?? connection.maxTokens,
      ...reasoning ? {
        reasoning: {
          efforts: REASONING_EFFORTS,
          defaultEffort: OFF_REASONING_EFFORT
        }
      } : {}
    };
  }
  async catalogModels(connection, refresh, signal) {
    if (connection.models !== void 0) return connection.models;
    const rawPat = await this.config.resolveApiKey(connection);
    const cacheKey = `${connection.endpoints.gateway}\0${hashCredential(rawPat)}`;
    const cached = modelCatalogCache.get(cacheKey);
    if (!refresh && cached !== void 0) return cached;
    const models = await this.fetchModelCatalog(connection, rawPat, signal);
    modelCatalogCache.set(cacheKey, models);
    return models;
  }
  async fetchModelCatalog(connection, rawPat, signal) {
    let jobToken;
    let identity;
    try {
      jobToken = await this.ensureJobToken(rawPat, connection.endpoints, signal);
      identity = await this.ensureIdentity(rawPat, jobToken, connection.endpoints, signal);
    } catch (error) {
      if (signal?.aborted) {
        throw new LlmError4("Qoder CN model discovery aborted by caller", "ABORTED", { cause: error });
      }
      if (error instanceof LlmError4) throw error;
      throw new LlmError4("Qoder CN model discovery could not authenticate", "DISCOVERY_FAILED", {
        cause: error
      });
    }
    const url = qoderModelListUrl(connection.endpoints);
    const headers = buildQoderAuthHeaders(null, url, {
      userID: identity.userID,
      authToken: jobToken,
      name: identity.name,
      email: identity.email,
      machineID: connection.machineId
    });
    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...headers,
          ...attributionHeaders()
        },
        signal
      });
    } catch (error) {
      if (signal?.aborted) {
        throw new LlmError4("Qoder CN model discovery aborted by caller", "ABORTED", { cause: error });
      }
      throw new LlmError4(`Could not reach Qoder CN model listing at ${url}`, "DISCOVERY_FAILED", {
        cause: error
      });
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new LlmError4(
        `Qoder CN model listing answered HTTP ${response.status}${detail.length > 0 ? `: ${detail.slice(0, 200)}` : ""}`,
        "DISCOVERY_FAILED",
        { status: response.status }
      );
    }
    let value;
    try {
      value = await response.json();
    } catch (error) {
      if (signal?.aborted) {
        throw new LlmError4("Qoder CN model discovery aborted by caller", "ABORTED", { cause: error });
      }
      throw new LlmError4("Qoder CN model listing did not answer with JSON", "DISCOVERY_FAILED", {
        cause: error
      });
    }
    return parseQoderModelCatalog(value);
  }
  async *stream(options) {
    var _stack = [];
    try {
      const connection = this.config.options();
      const rawPat = await this.config.resolveApiKey(connection);
      const consumer = new AbortController();
      const upstream = options.signal === void 0 ? consumer.signal : AbortSignal.any([options.signal, consumer.signal]);
      const watchdog = __using(_stack, idleWatchdog(upstream, connection.streamIdleTimeoutMs, STREAM_IDLE_TIMEOUT_CODE));
      const iterator = this.request(
        options,
        watchdog.signal,
        connection,
        rawPat,
        () => {
          watchdog.pulse();
        }
      )[Symbol.asyncIterator]();
      let exhausted = false;
      try {
        while (true) {
          const result = await watchdog.next(iterator);
          if (result.done) {
            exhausted = true;
            return;
          }
          yield result.value;
        }
      } catch (error) {
        if (timeoutOf(watchdog.signal, STREAM_IDLE_TIMEOUT_CODE) !== void 0) {
          throw new LlmError4(
            `Qoder CN stream idle timeout after ${connection.streamIdleTimeoutMs}ms`,
            "TIMEOUT",
            { cause: error }
          );
        }
        if (options.signal?.aborted) {
          throw new LlmError4("Qoder CN request aborted by caller", "ABORTED", { cause: error });
        }
        if (error instanceof LlmError4) throw error;
        throw new LlmError4("Qoder CN API stream failed", "TRANSPORT", { cause: error });
      } finally {
        consumer.abort("Qoder CN stream consumer stopped");
        if (!exhausted && iterator.return !== void 0) {
          try {
            await iterator.return();
          } catch (_abortedTransportTeardown) {
          }
        }
      }
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  async *request(options, signal, connection, rawPat, onComment) {
    const jobToken = await this.ensureJobToken(rawPat, connection.endpoints, signal);
    const identity = await this.ensureIdentity(rawPat, jobToken, connection.endpoints, signal);
    const machineId = connection.machineId;
    const qoderModel = getQoderCNDirectModel(options.model);
    const attachments = this.config.resolveAttachments();
    const messages = await serializeMessages(options, attachments);
    const tools = transformTools(options);
    const system = options.system ?? "";
    const originalContent = lastUserText(options.messages);
    const requestId = crypto2.randomUUID();
    const sessionID = crypto2.createHash("sha256").update(`qoder-session\0${identity.userID}\0${qoderModel}`).digest("hex").slice(0, 16);
    const recordID = stableChatRecordID(qoderModel, options);
    const maxTokens = options.maxTokens ?? connection.maxTokens;
    const reasoningEnabled = options.reasoningEffort !== void 0 && options.reasoningEffort !== "off";
    const reqBody = {
      request_id: requestId,
      request_set_id: recordID,
      chat_record_id: recordID,
      session_id: sessionID,
      stream: true,
      chat_task: "FREE_INPUT",
      is_reply: true,
      is_retry: false,
      source: 1,
      version: "3",
      session_type: "qodercli",
      agent_id: "agent_common",
      task_id: "common",
      code_language: "",
      chat_prompt: "",
      image_urls: null,
      aliyun_user_type: "",
      system,
      messages,
      tools: tools ?? [],
      parameters: {
        max_tokens: maxTokens,
        ...reasoningEnabled ? { reasoning_effort: options.reasoningEffort } : {}
      },
      chat_context: {
        chatPrompt: "",
        imageUrls: null,
        extra: {
          context: [],
          modelConfig: {
            key: qoderModel,
            is_reasoning: reasoningEnabled
          },
          originalContent
        },
        features: [],
        text: originalContent
      },
      model_config: {
        key: qoderModel,
        is_reasoning: reasoningEnabled,
        max_output_tokens: maxTokens,
        source: "system"
      },
      business: {
        product: "cli",
        version: "1.0.0",
        type: "agent",
        stage: "start",
        id: crypto2.randomUUID(),
        name: originalContent.substring(0, 30),
        begin_at: Date.now()
      }
    };
    const bodyBytes = Buffer.from(JSON.stringify(reqBody));
    const encodedBody = qoderEncodeBody(bodyBytes);
    const encodedBytes = Buffer.from(encodedBody, "utf8");
    const chatURL = qoderChatUrl(connection.endpoints);
    const cosyCreds = {
      userID: identity.userID,
      authToken: jobToken,
      name: identity.name,
      email: identity.email,
      machineID: machineId
    };
    const headers = buildQoderAuthHeaders(encodedBytes, chatURL, cosyCreds);
    let response;
    try {
      response = await fetch(chatURL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
          "Accept-Encoding": "identity",
          "X-Model-Key": qoderModel,
          "X-Model-Source": "system",
          ...headers,
          ...attributionHeaders()
        },
        body: encodedBytes,
        signal
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new LlmError4(
        `Qoder CN API request to ${chatURL} failed`,
        "TRANSPORT",
        { cause: error }
      );
    }
    if (!response.ok) {
      let message = `Qoder CN API error (HTTP ${response.status})`;
      let bodyText = "";
      try {
        bodyText = await response.text();
        if (bodyText.length > 0) message = bodyText.slice(0, 200);
      } catch {
      }
      throw new LlmError4(message, httpErrorCode(response.status, bodyText), {
        status: response.status
      });
    }
    if (!response.body) {
      throw new LlmError4("Qoder CN API returned no response body", "EMPTY_RESPONSE");
    }
    const envelopes = parseQoderSse(response.body);
    yield* translate(mapEnvelopes(envelopes, onComment), reasoningEnabled);
  }
  /** Exchange or refresh the job token for one PAT, caching per process. */
  async ensureJobToken(rawPat, endpoints, signal) {
    const key = hashCredential(rawPat);
    const cached = jobTokenCache.get(key);
    if (cached !== void 0 && cached.expiresAt > Date.now() + 5 * 60 * 1e3) {
      return cached.jobToken;
    }
    if (cached !== void 0 && cached.jobRefreshToken.length > 0) {
      try {
        const refreshed = await refreshJobToken(cached.jobRefreshToken, endpoints, signal);
        jobTokenCache.set(key, refreshed);
        return refreshed.jobToken;
      } catch (error) {
        if (signal?.aborted) throw error;
      }
    }
    try {
      const exchanged = await exchangeJobToken(rawPat, endpoints, signal);
      jobTokenCache.set(key, exchanged);
      return exchanged.jobToken;
    } catch (error) {
      if (error instanceof Error && /failed:\s*\d{3}/.test(error.message)) {
        throw new LlmError4(
          `Qoder CN PAT exchange failed: ${error.message}`,
          "AUTH",
          { cause: error }
        );
      }
      throw error;
    }
  }
  /** Resolve the server identity for one PAT, caching per process. */
  async ensureIdentity(rawPat, jobToken, endpoints, signal) {
    const key = hashCredential(rawPat);
    const cached = identityCache.get(key);
    if (cached?.userID) return cached;
    const info = await fetchUserInfo(jobToken, endpoints, signal);
    if (!info.userID) {
      throw new LlmError4(
        "Qoder CN identity unavailable: /userinfo did not return a userID. Check the PAT and VPC routing (QODER_VPC_INSTANCE), then retry.",
        "AUTH"
      );
    }
    const resolved = {
      userID: info.userID,
      email: info.email || "user@qoder.com.cn",
      name: info.name || "Qoder CN User"
    };
    identityCache.set(key, resolved);
    return resolved;
  }
};
function stableChatRecordID(model, options) {
  const hash = crypto2.createHash("sha256");
  hash.update("qoder-record");
  hash.update("\0");
  hash.update(model);
  for (const msg of options.messages) {
    hash.update("\0");
    hash.update(msg.role);
    for (const block of msg.content) {
      hash.update("\0");
      hash.update(block.type);
      if (block.type === "text" || block.type === "reasoning") hash.update(block.text);
      if (block.type === "tool-call") {
        hash.update(block.name);
        hash.update(block.arguments);
      }
      if (block.type === "tool-result") {
        hash.update(block.toolCallId);
      }
    }
  }
  if (options.system !== void 0) {
    hash.update("\0");
    hash.update(options.system);
  }
  hash.update("\0");
  hash.update(`mt=${options.maxTokens ?? "default"}`);
  return hash.digest("hex").slice(0, 16);
}
async function* mapEnvelopes(payloads, onComment) {
  for await (const payload of payloads) {
    onComment();
    if (payload === DONE) {
      yield DONE;
      return;
    }
    yield parseEnvelope(payload);
  }
}

// src/index.ts
var name = "llm-qoder";
var inject = ["llm"];
var NS = settingsNamespace("llm-qoder");
var DEFAULT_API_KEY_ENV = "QODERCN_PERSONAL_ACCESS_TOKEN";
var PROVIDER = "qoder-cn";
var catalogModel = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  inputModalities: z.array(z.union(["text", "image"])),
  reasoning: z.boolean()
});
var connectionFields = {
  apiKeyEnv: z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV),
  vpcInstance: z.string(),
  baseURL: z.string(),
  openApiUrl: z.string(),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_TOKENS),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  // Schemastery arrays otherwise materialize [], which would disable live discovery.
  models: z.array(catalogModel).default(void 0),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  retryPolicy: RetryPolicySchema
};
var Config = z.object({
  apiKeyEnv: connectionFields.apiKeyEnv,
  vpcInstance: connectionFields.vpcInstance,
  baseURL: connectionFields.baseURL,
  openApiUrl: connectionFields.openApiUrl,
  maxTokens: connectionFields.maxTokens,
  defaultContextWindow: connectionFields.defaultContextWindow,
  models: connectionFields.models,
  streamIdleTimeoutMs: connectionFields.streamIdleTimeoutMs,
  retryPolicy: connectionFields.retryPolicy,
  providers: z.dict(z.object(connectionFields))
});
var PUBLIC_GATEWAY_URL = "https://gateway.qoder.com.cn";
function resolveModels(models) {
  if (models === void 0) return void 0;
  const seen = /* @__PURE__ */ new Set();
  return models.map((model) => {
    if (model.id.length === 0) throw new Error("llm-qoder: catalog model ids must be non-empty");
    if (model.name !== void 0 && model.name.length === 0) {
      throw new Error(`llm-qoder: catalog model "${model.id}" has an empty name`);
    }
    if (model.contextWindow !== void 0 && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
      throw new Error(
        `llm-qoder: catalog model "${model.id}" contextWindow must be a positive integer`
      );
    }
    if (model.maxTokens !== void 0 && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) {
      throw new Error(
        `llm-qoder: catalog model "${model.id}" maxTokens must be a positive integer`
      );
    }
    if (seen.has(model.id)) throw new Error(`llm-qoder: duplicate catalog model "${model.id}"`);
    seen.add(model.id);
    return {
      id: model.id,
      ...model.name === void 0 ? {} : { name: model.name },
      ...model.description === void 0 ? {} : { description: model.description },
      ...model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === void 0 ? {} : { maxTokens: model.maxTokens },
      ...model.inputModalities === void 0 ? {} : { inputModalities: [...model.inputModalities] },
      ...model.reasoning === void 0 ? {} : { reasoning: model.reasoning }
    };
  });
}
function resolveAdapterOptions(config, environment) {
  const profile = config.providers?.[PROVIDER];
  if (profile !== void 0) {
    config = { ...config, ...profile };
  }
  if (config.defaultContextWindow !== void 0 && (!Number.isInteger(config.defaultContextWindow) || config.defaultContextWindow <= 0)) {
    throw new Error("llm-qoder: defaultContextWindow must be a positive integer");
  }
  if (config.maxTokens !== void 0 && (!Number.isSafeInteger(config.maxTokens) || config.maxTokens <= 0)) {
    throw new Error("llm-qoder: maxTokens must be a positive safe integer");
  }
  const streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
  if (!Number.isFinite(streamIdleTimeoutMs) || streamIdleTimeoutMs <= 0 || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `llm-qoder: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`
    );
  }
  const get = (name2) => environment?.get(name2);
  const vpcInstance = config.vpcInstance ?? parseVpcInstanceFromEnvironment(get);
  const endpoints = qoderCnEndpoints(vpcInstance);
  const finalEndpoints = {
    gateway: config.baseURL?.replace(/\/+$/, "") ?? endpoints.gateway,
    openapi: config.openApiUrl?.replace(/\/+$/, "") ?? endpoints.openapi,
    manage: endpoints.manage
  };
  return {
    endpoints: finalEndpoints,
    apiKeyEnv: credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV),
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    defaultContextWindow: config.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
    models: resolveModels(config.models),
    streamIdleTimeoutMs,
    retryPolicy: resolveRetryPolicy(config.retryPolicy, "llm-qoder: retryPolicy"),
    machineId: getMachineId(dshHomePath())
  };
}
function apply(ctx, config) {
  let current = () => config;
  let lastRaw;
  let lastGood;
  const options = () => {
    const raw = current();
    if (raw === lastRaw && lastGood !== void 0) return lastGood;
    try {
      const next = resolveAdapterOptions(raw, launchEnvironmentOf(ctx));
      lastRaw = raw;
      lastGood = next;
      return next;
    } catch (error) {
      if (lastGood === void 0) throw error;
      lastRaw = raw;
      ctx.logger.error("llm-qoder: keeping the last good configuration after an invalid settings section");
      ctx.logger.error(error);
      return lastGood;
    }
  };
  options();
  const resolveApiKey = async (connection) => {
    const ref = connection.apiKeyEnv;
    const credentials = ctx.get("credentials");
    if (credentials !== void 0) {
      const hit = await credentials.resolve(ref);
      if (hit !== void 0) return assertUsableApiKey(hit.value, "llm-qoder", ref);
    } else {
      const ambient = launchEnvironmentOf(ctx).get(ref);
      if (ambient !== void 0 && ambient.value.length > 0) {
        return assertUsableApiKey(ambient.value, "llm-qoder", ref);
      }
    }
    const patAlias = launchEnvironmentOf(ctx).get("QODERCN_PAT");
    if (patAlias !== void 0 && patAlias.value.length > 0) {
      return assertUsableApiKey(patAlias.value, "llm-qoder", ref);
    }
    const apiKeyAlias = launchEnvironmentOf(ctx).get("QODER_API_KEY");
    if (apiKeyAlias !== void 0 && isQoderPatValue(apiKeyAlias.value)) {
      return assertUsableApiKey(apiKeyAlias.value.trim(), "llm-qoder", ref);
    }
    throw new LlmError5(
      `llm-qoder: no PAT for provider route "${PROVIDER}"; store ${ref} through the credentials service (the web Models page writes it), or export ${ref} in the launching environment`,
      "MISSING_CREDENTIAL"
    );
  };
  const adapter = new QoderAdapter({
    options,
    resolveApiKey,
    resolveAttachments: () => ctx.get("attachments")
  });
  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: PROVIDER, settingsNs: NS, settingsPath: ["providers", PROVIDER] }
  ]);
  const registration = ctx.llm.registerAdapter([PROVIDER], adapter);
  let registeredPolicy = options().retryPolicy;
  const ensureRegistrationFacts = () => {
    const policy = options().retryPolicy;
    if (deepEqualJson(policy, registeredPolicy)) return;
    registration.replace([PROVIDER]);
    registeredPolicy = policy;
  };
  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source) => {
      current = source;
    },
    onChange: ensureRegistrationFacts
  });
}
export {
  Config,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  PUBLIC_GATEWAY_URL,
  QoderAdapter,
  apply,
  buildQoderAuthHeaders,
  exchangeJobToken,
  fetchUserInfo,
  getQoderCNDirectModel,
  inject,
  name,
  parseQoderModelCatalog,
  qoderCnEndpoints,
  qoderEncodeBody,
  refreshJobToken,
  resolveAdapterOptions
};
