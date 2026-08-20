/**
 * Qoder CN wire identity: endpoint derivation (public / enterprise-VPC),
 * COSY signature headers, and machine-id persistence.
 *
 * Ported from the pi provider extension (`pi-provider-qoder`), restricted to
 * the CN region the `qoder-cn` provider route serves. The signature scheme is
 * the server's contract: the AES key that encrypts the user-info envelope is
 * carried base64-RSA-wrapped as `Cosy-Key`, and the `Authorization` bearer is
 * `COSY.<base64(payload)>.<md5(payloadB64\ncosyKey\ntimestamp\nbody\nsigPath)>`.
 * The WAF-encoded body (see `qoder-encoding.ts`) is what the signature covers,
 * and `Cosy-Machineid` persists across restarts so the gateway can correlate
 * sessions. All constants below are wire facts, not tunables — they must match
 * the qodercli client exactly, so they stay fixed here.
 *
 * @module dsh-llm-qoder/cosy
 */

import crypto from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const qoderRSAPublicKey = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`

/** Client identity the gateway recognises as the official qodercli desktop. */
const QoderIDEVersion = '1.0.0'
const QoderClientType = '5'
const QoderDataPolicy = 'disagree'
const QoderLoginVersion = 'v2'
const QoderMachineOS = 'x86_64_windows'
const QoderMachineTypeMagic = '5'

const QoderVPCDomain = 'vpc.qoder.com.cn'

/** Credential/identity facts used to build one COSY signed request. */
export interface CosyCredentials {
  /** Server user id resolved from /userinfo; empty is not signable. */
  userID: string
  /** Short-lived job token (jt-...) exchanged from the PAT. */
  authToken: string
  name: string
  email: string
  machineID?: string
}

interface UserInfo {
  uid: string
  security_oauth_token: string
  name: string
  aid: string
  email: string
}

interface CosyPayload {
  version: string
  requestId: string
  info: string
  cosyVersion: string
  ideVersion: string
}

/**
 * True when the value looks like a Qoder PAT (`pt-...`), not a job token.
 * @param value - the credential string to test.
 * @returns true when the trimmed value begins with `pt-`.
 */
export function isQoderPatValue(value?: string): boolean {
  return Boolean(value?.trim().startsWith('pt-'))
}

/**
 * Resolve a Qoder CN PAT from the environment. `QODER_API_KEY` is accepted only
 * when its value is a PAT (`pt-...`), never an opaque key.
 * @returns the trimmed PAT, or an empty string when none is available.
 */
export function getQoderCNPat(): string {
  const dedicated = process.env.QODERCN_PERSONAL_ACCESS_TOKEN || process.env.QODERCN_PAT || ''
  if (dedicated.trim()) return dedicated.trim()
  const apiKey = process.env.QODER_API_KEY || ''
  return isQoderPatValue(apiKey) ? apiKey.trim() : ''
}

function parseQoderVPCInstance(value?: string): string | undefined {
  if (!value?.trim()) return undefined

  let candidate = value.trim().toLowerCase()
  try {
    candidate = new URL(candidate.includes('://') ? candidate : `https://${candidate}`).hostname
  } catch {
    return undefined
  }

  const suffix = `.${QoderVPCDomain}`
  if (candidate.endsWith(suffix)) {
    candidate = candidate.slice(0, -suffix.length)
    if (candidate.endsWith('-gateway') || candidate.endsWith('-openapi')) {
      candidate = candidate.slice(0, -8)
    }
  } else if (candidate.includes('.')) {
    return undefined
  }

  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(candidate) ? candidate : undefined
}

/**
 * One CN wire-endpoint set. Public-cloud defaults, overridable per deployment
 * (enterprise VPC derives the service hosts from the tenant instance).
 */
export interface QoderCnEndpoints {
  /** Gateway origin (no trailing slash) hosting the algo service. */
  gateway: string
  /** OpenAPI origin hosting token exchange, refresh, and userinfo. */
  openapi: string
  /** Tenant dashboard origin (`<instance>.vpc.qoder.com.cn`), when VPC-routed. */
  manage: string
}

/**
 * Resolve the CN endpoints from an optional VPC instance.
 * @param vpcInstance - tenant instance name (`<instance>.vpc.qoder.com.cn`);
 *   absent selects the public cloud.
 * @returns the three origins with no trailing slashes.
 */
export function qoderCnEndpoints(vpcInstance?: string): QoderCnEndpoints {
  if (vpcInstance !== undefined && vpcInstance.length > 0) {
    return {
      gateway: `https://${vpcInstance}-gateway.${QoderVPCDomain}`,
      openapi: `https://${vpcInstance}-openapi.${QoderVPCDomain}`,
      manage: `https://${vpcInstance}.${QoderVPCDomain}`,
    }
  }
  return {
    gateway: 'https://gateway.qoder.com.cn',
    openapi: 'https://openapi.qoder.com.cn',
    manage: 'https://qoder.com.cn',
  }
}

/**
 * PAT → job-token exchange endpoint.
 * @param endpoints - resolved CN endpoints.
 * @returns the absolute exchange URL.
 */
export function qoderExchangeUrl(endpoints: QoderCnEndpoints): string {
  return `${endpoints.openapi}/api/v1/jobToken/exchange`
}

/**
 * Job-token refresh endpoint.
 * @param endpoints - resolved CN endpoints.
 * @returns the absolute refresh URL.
 */
export function qoderJobTokenRefreshUrl(endpoints: QoderCnEndpoints): string {
  return `${endpoints.openapi}/api/v1/jobToken/refresh`
}

/**
 * Identity lookup endpoint.
 * @param endpoints - resolved CN endpoints.
 * @returns the absolute userinfo URL.
 */
export function qoderUserInfoUrl(endpoints: QoderCnEndpoints): string {
  return `${endpoints.openapi}/api/v1/userinfo`
}

/**
 * Streaming chat endpoint (WAF-encoded bodies, `FetchKeys=llm_model_result`).
 * @param endpoints - resolved CN endpoints.
 * @returns the absolute agent_chat_generation URL.
 */
export function qoderChatUrl(endpoints: QoderCnEndpoints): string {
  return `${endpoints.gateway}/algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1`
}

/**
 * Model-catalog endpoint used by discovery.
 * @param endpoints - resolved CN endpoints.
 * @returns the absolute model-list URL.
 */
export function qoderModelListUrl(endpoints: QoderCnEndpoints): string {
  return `${endpoints.gateway}/algo/api/v2/model/list`
}

/**
 * Map a Qoder CN deployment-facing model id to its wire key, passing unknown
 * ids through unchanged.
 * @param modelID - the deployment-facing id (`deepseek-v4-pro`, `auto`, …).
 * @returns the wire key the gateway expects.
 */
export function getQoderCNDirectModel(modelID?: string): string {
  return (
    {
      'qoder-cn': 'auto',
      'qwen3.7-max': 'qmodel_latest',
      'qwen3.7-plus': 'qmodel',
      'qwen3.6-plus': 'qmodel',
      'qwen3.6-flash': 'q36fmodel',
      'deepseek-v4-pro': 'dmodel',
      'deepseek-v4-flash': 'dfmodel',
      'glm-5.2': 'gm51model',
      'glm-5.1': 'gm51model',
      'kimi-k2.6': 'kmodel',
      'minimax-m2.7': 'mmodel',
      'minimax-m3': 'mmodel',
    }[modelID || ''] ||
    modelID ||
    'auto'
  )
}

/**
 * Prettify an upstream display name (`Qwen3.7` → `Qwen 3.7`). The provider
 * id already names the route, so model labels do not repeat it.
 * @param name - the upstream display name.
 * @returns the prettified selector label.
 */
export function prettifyQoderCNModelName(name: string): string {
  return (name || 'Model')
    .replace(/\s*·\s*Qoder CN\s*$/i, '')
    .replace(/Qwen(\d)/g, 'Qwen $1')
    .replace(/Qwen([\d.]+)-/g, 'Qwen $1 ')
    .replace(/DeepSeek\s*V(\d)-/g, 'DeepSeek V$1 ')
    .replace(/\s+/g, ' ')
    .trim()
}

function rsaEncryptBase64(data: string): string {
  const encrypted = crypto.publicEncrypt(
    { key: qoderRSAPublicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(data),
  )
  return encrypted.toString('base64')
}

function aesEncryptCBCBase64(plaintext: string, keyStr: string): string {
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(keyStr), Buffer.from(keyStr))
  let encrypted = cipher.update(plaintext, 'utf8', 'base64')
  encrypted += cipher.final('base64')
  return encrypted
}

/** The path portion the gateway signs, with the `/algo` prefix stripped. */
function computeSigPath(urlStr: string): string {
  const parsed = new URL(urlStr)
  let sigPath = parsed.pathname
  if (sigPath.startsWith('/algo')) {
    sigPath = sigPath.substring('/algo'.length)
  }
  return sigPath
}

/**
 * Persistable machine-id read in the qodercli / pi plugin order so an existing
 * install is recognised, generated once and stored under the harness home
 * otherwise. The gateway uses this id to correlate sessions across restarts.
 * @param dshHome - harness home directory returned by `dshHomePath()`.
 * @returns the stable machine id.
 */
export function getMachineId(dshHome: string): string {
  const paths = [
    join(homedir(), '.qoder', '.auth', 'machine_id'),
    join(homedir(), '.pi', 'agent', 'qoder-machine-id'),
    join(dshHome, 'qoder-machine-id'),
  ]
  for (const p of paths.slice(0, 2)) {
    if (existsSync(p)) {
      try {
        const val = readFileSync(p, 'utf8').trim()
        if (val) return val
      } catch {
        // An unreadable fallback file is skipped; generation is the next step.
      }
    }
  }
  const newId = crypto.randomUUID()
  try {
    const savePath = paths[2] as string
    mkdirSync(dirname(savePath), { recursive: true })
    writeFileSync(savePath, newId, 'utf8')
  } catch {
    // Persistence is best-effort; the generated id still signs this process.
  }
  return newId
}

/**
 * Build the COSY signature headers for one request. The request body covered
 * by the signature is the WAF-encoded bytes sent on the wire.
 * @param body - the WAF-encoded request body sent in the POST (string form).
 * @param requestURL - the exact request URL.
 * @param creds - user identity + job token; userID and authToken are required.
 * @returns the header bag to merge into the request.
 */
export function buildQoderAuthHeaders(
  body: Buffer | string | null,
  requestURL: string,
  creds: CosyCredentials,
): Record<string, string> {
  if (!creds.userID) {
    throw new Error('cosy: user id is empty')
  }
  if (!creds.authToken) {
    throw new Error('cosy: auth token is empty')
  }

  const aesKey = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  const userInfo: UserInfo = {
    uid: creds.userID,
    security_oauth_token: creds.authToken,
    name: creds.name || '',
    aid: '',
    email: creds.email || '',
  }

  const infoB64 = aesEncryptCBCBase64(JSON.stringify(userInfo), aesKey)
  const cosyKey = rsaEncryptBase64(aesKey)

  const timestamp = Math.floor(Date.now() / 1000).toString()
  const requestId = crypto.randomUUID()

  const cosyPayload: CosyPayload = {
    version: 'v1',
    requestId,
    info: infoB64,
    cosyVersion: QoderIDEVersion,
    ideVersion: '',
  }

  const payloadB64 = Buffer.from(JSON.stringify(cosyPayload)).toString('base64')
  const sigPath = computeSigPath(requestURL)

  const bodyStr = body ? (Buffer.isBuffer(body) ? body.toString('utf8') : body) : ''
  const sigInput = `${payloadB64}\n${cosyKey}\n${timestamp}\n${bodyStr}\n${sigPath}`
  const sig = crypto.createHash('md5').update(sigInput).digest('hex')

  const bodyHash = crypto
    .createHash('md5')
    .update(body || '')
    .digest('hex')
  const bodyLen = body ? (Buffer.isBuffer(body) ? body.length : Buffer.from(body).length).toString() : '0'

  const machineID = creds.machineID || getMachineId(process.env.DSH_HOME || join(homedir(), '.dsh'))

  return {
    Authorization: `Bearer COSY.${payloadB64}.${sig}`,
    'Cosy-Key': cosyKey,
    'Cosy-User': creds.userID,
    'Cosy-Date': timestamp,
    'Cosy-Version': QoderIDEVersion,
    'Cosy-Machineid': machineID,
    'Cosy-Machinetoken': machineID,
    'Cosy-Machinetype': QoderMachineTypeMagic,
    'Cosy-Machineos': QoderMachineOS,
    'Cosy-Clienttype': QoderClientType,
    'Cosy-Clientip': '127.0.0.1',
    'Cosy-Bodyhash': bodyHash,
    'Cosy-Bodylength': bodyLen,
    'Cosy-Sigpath': sigPath,
    'Cosy-Data-Policy': QoderDataPolicy,
    'Cosy-Organization-Id': '',
    'Cosy-Organization-Tags': '',
    'Login-Version': QoderLoginVersion,
    'X-Request-Id': crypto.randomUUID(),
  }
}

/**
 * Parse a VPC instance from raw environment values, considering all aliases.
 * @param get - a snapshot lookup (e.g. `launchEnvironmentOf(ctx).get`).
 * @returns the tenant instance name, or `undefined` when none is configured.
 */
export function parseVpcInstanceFromEnvironment(get: (name: string) => { value: string } | undefined): string | undefined {
  return parseQoderVPCInstance(
    get('QODER_VPC_INSTANCE')?.value ??
    get('QODER_VPC_ENDPOINT')?.value ??
    get('QODERCN_VPC_ENDPOINT')?.value ??
    get('QODERCN_CLI_VPC_ENDPOINT')?.value ??
    get('QODER_CN_BASE_URL')?.value ??
    get('QODER_CN_OPENAPI_URL')?.value ??
    get('QODER_CN_CENTER_URL')?.value,
  )
}
