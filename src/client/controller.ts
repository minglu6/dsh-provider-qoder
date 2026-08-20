import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsScope, SettingsScopeSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Host settings namespace this card edits. */
export const QODER_NS = 'llm-qoder'

/** Credential reference the adapter resolves when the section names none. */
export const DEFAULT_API_KEY_REF = 'QODERCN_PERSONAL_ACCESS_TOKEN'

/** Fields this card reads from the `llm-qoder` section. */
export interface QoderSettings {
  apiKeyEnv?: string
  vpcInstance?: string
}

/** What the credentials domain last reported. */
interface CredentialState {
  ref: string
  configured: boolean
  writable: boolean
}

/** Snapshot the card component reads. */
export interface QoderCardState {
  available: boolean
  writable: boolean
  dirty: boolean
  saving: boolean
  failed: boolean
  pat: string
  patConfigured: boolean
  patWritable: boolean
  vpc: string
  vpcOverridden: boolean
}

/** Face injected into the plugin-item slot. */
export interface QoderCardFace {
  hooks: { qoderCard: SnapshotStore<QoderCardState> }
  editPat: (text: string) => void
  editVpc: (text: string) => void
  resetVpc: () => void
  save: () => void
  discard: () => void
}

/** Stage PAT + VPC and write them on save. */
export class QoderCardController {
  private patDraft = ''
  private vpcDraft: string | undefined
  private vpcClear = false
  private saving = false
  private failed = false
  private credential: CredentialState = { ref: '', configured: false, writable: true }
  private readonly store: SnapshotStore<QoderCardState>

  /**
   * @param scope - bound `llm-qoder` settings scope.
   * @param api - credentials wire face.
   */
  constructor(
    private readonly scope: SettingsScope<QoderSettings>,
    private readonly api: Pick<IApiClient, 'credentials'>,
  ) {
    this.store = createSnapshotStore(this.projection())
    scope.subscribe(() => {
      void this.readCredential()
      this.publish()
    })
    void this.readCredential()
  }

  /** Re-read after another surface writes the same credential reference. */
  refreshCredential(ref: string): void {
    if (ref !== this.credential.ref) return
    void this.readCredential()
  }

  /** Slot inject face. */
  inject(): QoderCardFace {
    return {
      hooks: { qoderCard: this.store },
      editPat: (text) => {
        this.patDraft = text
        this.publish()
      },
      editVpc: (text) => {
        this.vpcDraft = text
        this.vpcClear = text.trim().length === 0
        this.publish()
      },
      resetVpc: () => {
        this.vpcDraft = ''
        this.vpcClear = true
        this.publish()
      },
      save: () => { void this.save() },
      discard: () => {
        this.patDraft = ''
        this.vpcDraft = undefined
        this.vpcClear = false
        this.failed = false
        this.publish()
      },
    }
  }

  private projection(): QoderCardState {
    const snapshot = this.scope.getSnapshot()
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.dirty(snapshot),
      saving: this.saving,
      failed: this.failed,
      pat: this.patDraft,
      patConfigured: this.credential.configured,
      patWritable: this.credential.writable,
      vpc: this.vpcDraft !== undefined ? this.vpcDraft : stringOf(snapshot.value?.vpcInstance),
      vpcOverridden: this.vpcClear || hasUserField(snapshot.user, 'vpcInstance'),
    }
  }

  private dirty(snapshot: SettingsScopeSnapshot<QoderSettings>): boolean {
    if (this.patDraft.trim().length > 0) return true
    if (this.vpcClear) return hasUserField(snapshot.user, 'vpcInstance')
    if (this.vpcDraft === undefined) return false
    return this.vpcDraft.trim() !== stringOf(snapshot.value?.vpcInstance)
  }

  private publish(): void {
    this.store.set(this.projection())
  }

  private async readCredential(): Promise<void> {
    const ref = refOf(this.scope.getSnapshot())
    if (ref !== this.credential.ref) {
      this.credential = { ref, configured: false, writable: true }
      this.publish()
    }
    let response: Awaited<ReturnType<IApiClient['credentials']['describe']>>
    try {
      response = await this.api.credentials.describe({ refs: [ref] })
    } catch {
      return
    }
    if (!response.result.ok || ref !== refOf(this.scope.getSnapshot())) return
    const view = response.result.value.credentials[ref]
    this.credential = {
      ref,
      configured: view?.configured ?? false,
      writable: view?.writable ?? true,
    }
    this.publish()
  }

  private async save(): Promise<void> {
    if (this.saving) return
    this.saving = true
    this.failed = false
    this.publish()
    try {
      const snapshot = this.scope.getSnapshot()
      if (this.patDraft.trim().length > 0) {
        const stored = await this.api.credentials.set({
          ref: refOf(snapshot),
          value: this.patDraft.trim(),
        })
        if (!stored.result.ok) throw new Error(stored.result.error.message)
        this.patDraft = ''
        await this.readCredential()
      }
      if (this.vpcClear) {
        await this.scope.unset('vpcInstance')
      } else if (this.vpcDraft !== undefined && this.vpcDraft.trim().length > 0) {
        await this.scope.set('vpcInstance', this.vpcDraft.trim())
      }
      this.vpcDraft = undefined
      this.vpcClear = false
    } catch {
      this.failed = true
    } finally {
      this.saving = false
      this.publish()
    }
  }
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function hasUserField(user: unknown, field: string): boolean {
  return typeof user === 'object' && user !== null && field in user
}

function refOf(snapshot: SettingsScopeSnapshot<QoderSettings>): string {
  const declared = snapshot.value?.apiKeyEnv
  return declared !== undefined && declared.length > 0 ? declared : DEFAULT_API_KEY_REF
}
