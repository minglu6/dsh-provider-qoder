/** Revision-fenced connection edits and write-only PAT storage for the Qoder card. */
import type { CredentialInfo, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

/** Entry id exposed by the bundle's live settings form. */
export const settingsNamespace = 'llm-qoder'
const editableFields = ['vpcInstance', 'baseURL', 'openApiUrl'] as const
/** Connection fields editable without changing model or retry configuration. */
export type ConnectionFields = Record<(typeof editableFields)[number], string>
/** Settings fields consumed by the card; the Host owns their validation. */
export interface QoderConfig {
  apiKeyEnv?: string
  vpcInstance?: string
  baseURL?: string
  openApiUrl?: string
  providers?: Record<string, Partial<Omit<QoderConfig, 'providers'>>>
}
/** Unsaved form values and the configuration revision they were opened against. */
export interface Draft extends ConnectionFields {
  pat: string
  ref: string
  path: string[]
  revision: number
  original: ConnectionFields
}
/** Localized failure categories; transport errors must not expose submitted credentials. */
export type SaveError = 'readOnly' | 'credentialReadOnly' | 'credentialFailed' | 'settingsFailed' | 'conflict' | 'loadFailed'
/** Host operations used by the write-only credential editor. */
export interface Operations {
  describe(ref: string): Promise<CredentialInfo | undefined>
  mutate(ops: SettingsPathOpView[], revision: number): Promise<
    { ok: true; value: SettingsNamespaceView } | { ok: false; error: { code: string } }
  >
  store(ref: string, pat: string): Promise<boolean>
  subscribeCredentials(listener: () => void): () => void
}

/**
 * Resolve profile overrides over root configuration.
 * @param config - Effective Host configuration.
 * @returns Editable values and their credential reference and settings path.
 */
export function connection(config: QoderConfig): ConnectionFields & { ref: string; path: string[] } {
  const profile = config.providers?.['qoder-cn']
  return {
    vpcInstance: profile?.vpcInstance ?? config.vpcInstance ?? '',
    baseURL: profile?.baseURL ?? config.baseURL ?? '',
    openApiUrl: profile?.openApiUrl ?? config.openApiUrl ?? '',
    ref: profile?.apiKeyEnv ?? config.apiKeyEnv ?? 'QODERCN_PERSONAL_ACCESS_TOKEN',
    path: profile === undefined ? [] : ['providers', 'qoder-cn'],
  }
}

/**
 * Open an editor without reading the stored PAT.
 * @param config - Effective Host configuration.
 * @param revision - Revision used to reject concurrent configuration edits.
 * @returns An independent draft with an empty PAT field.
 */
export function createDraft(config: QoderConfig, revision: number): Draft {
  const { ref, path, ...fields } = connection(config)
  return { ...fields, ref, path, revision, pat: '', original: fields }
}

/**
 * Preserve model overrides and unrelated fields while editing the connection.
 * @param draft - Current editor values and their original values.
 * @returns Only changed connection-field operations.
 */
export function draftOperations(draft: Draft): SettingsPathOpView[] {
  return editableFields.flatMap(field => {
    const value = draft[field].trim()
    return value === draft.original[field] ? [] : [{ op: 'set' as const, path: [...draft.path, field], value }]
  })
}

/** Save outcome including the retained draft after partial persistence. */
export interface SaveResult {
  draft: Draft
  error?: SaveError
  settingsSaved: boolean
}

/**
 * Commit settings before the credential; retain the committed revision if credential storage fails.
 * @param draft - User input and its initial settings revision.
 * @param snapshot - Current form availability and write policy.
 * @param operations - Host settings and credential operations.
 * @returns Retriable draft and localized failure category, or a cleared PAT after success.
 */
export async function saveDraft(
  draft: Draft,
  snapshot: ConfigFormSnapshot<QoderConfig>,
  operations: Operations,
): Promise<SaveResult> {
  let retained = draft
  let settingsSaved = false
  const fail = (error: SaveError): SaveResult => ({ draft: retained, error, settingsSaved })
  if (snapshot.status !== 'ready' || !snapshot.writable || snapshot.mode !== 'host') return fail('readOnly')
  const pat = draft.pat.trim()
  if (pat) {
    try {
      const info = await operations.describe(draft.ref)
      if (!info) return fail('loadFailed')
      if (!info.writable) return fail('credentialReadOnly')
    } catch {
      // Transport diagnostics may include request data; only localized status reaches the card.
      return fail('loadFailed')
    }
  }
  const ops = draftOperations(draft)
  try {
    // Even a PAT-only save fences the reference against a stale namespace revision.
    const written = await operations.mutate(ops, draft.revision)
    if (!written.ok) return fail(written.error.code === 'settings/conflict' ? 'conflict' : 'settingsFailed')
    settingsSaved = ops.length > 0
    retained = { ...createDraft(written.value.value as QoderConfig, written.value.revision), pat: draft.pat }
  } catch {
    // Keep the draft and hide transport details from the credential editor.
    return fail('settingsFailed')
  }
  if (pat) {
    try {
      if (!await operations.store(retained.ref, pat)) return fail('credentialFailed')
    } catch {
      // Never render a transport error that could contain the submitted PAT.
      return fail('credentialFailed')
    }
  }
  return { draft: { ...retained, pat: '' }, settingsSaved }
}
