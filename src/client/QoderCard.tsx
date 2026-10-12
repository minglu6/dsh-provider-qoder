/** Plugin-owned Qoder CN connection editor rendered in the official Models-page footer. */
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CredentialInfo } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { connection, createDraft, saveDraft, type Draft, type Operations, type QoderConfig, type SaveError } from './operations.ts'
import type { Translate } from './locales.ts'

/** Form state, Host operations, and localized copy supplied by the slot registration. */
export interface QoderCardProps {
  form: ConfigForm<QoderConfig>
  operations: Operations
  t: Translate
}

/**
 * Render the connection editor without exposing stored credential values.
 * @param props - Live form and credential operations.
 * @returns The editable Qoder CN connection card.
 */
export function QoderCard({ form, operations, t }: QoderCardProps) {
  const subscribe = useCallback((listener: () => void) => form.subscribe(listener), [form])
  const getSnapshot = useCallback(() => form.getSnapshot(), [form])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)
  const effective = connection(snapshot.value ?? {})
  const [draft, setDraft] = useState<Draft>()
  const [failure, setFailure] = useState<SaveError>()
  const [partial, setPartial] = useState(false)
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  const [refresh, setRefresh] = useState(0)
  const [credential, setCredential] = useState<{ ref: string; info?: CredentialInfo; failed: boolean }>()
  const id = useId()
  const ref = draft?.ref ?? effective.ref
  const info = credential?.ref === ref ? credential.info : undefined
  const failed = credential?.ref === ref && credential.failed
  const readOnly = snapshot.status !== 'ready' || !snapshot.writable || snapshot.mode !== 'host'

  useEffect(() => operations.subscribeCredentials(() => { setRefresh(value => value + 1) }), [operations])
  useEffect(() => {
    let active = true
    if (snapshot.status !== 'ready') return
    void operations.describe(ref).then(info => {
      if (active) setCredential({ ref, info, failed: info === undefined })
    }).catch(() => {
      if (active) setCredential({ ref, failed: true })
    })
    return () => { active = false }
  }, [operations, ref, refresh, snapshot.status])

  const submit = async (): Promise<void> => {
    if (!draft || saving.current) return
    saving.current = true
    setBusy(true)
    setFailure(undefined)
    try {
      const result = await saveDraft(draft, form.getSnapshot(), operations)
      setPartial(previous => previous || (result.settingsSaved && result.error !== undefined))
      if (result.error) {
        setDraft(result.draft)
        setFailure(result.error)
      } else {
        setDraft(undefined)
        setPartial(false)
      }
      setRefresh(value => value + 1)
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  return <section className="qoder-cn-card" aria-labelledby={`${id}-title`} aria-busy={busy || snapshot.status === 'loading'}>
    <header className="qoder-cn-card__header">
      <h3 id={`${id}-title`}>{t('title')}</h3>
      <span className="qoder-cn-card__status">{t(info ? info.configured ? 'configured' : 'missing' : 'unknown')}</span>
      {!draft && <Button variant="outline" size="sm" disabled={readOnly} onClick={() => {
        if (snapshot.value === undefined || snapshot.revision === undefined) return
        setDraft(createDraft(snapshot.value, snapshot.revision))
        setFailure(undefined)
        setPartial(false)
      }}>{t('edit')}</Button>}
    </header>
    <p className="qoder-cn-card__hint">{t('intro')}</p>
    {snapshot.status === 'unavailable' ? <p className="qoder-cn-card__error">{t('unavailable')}</p>
      : snapshot.status === 'ready' && readOnly ? <p className="qoder-cn-card__hint">{t('readOnly')}</p> : null}
    {failed && <div className="qoder-cn-card__notice" role="alert">
      <span>{t('loadFailed')}</span>
      <Button size="sm" disabled={busy} onClick={() => { setRefresh(value => value + 1) }}>{t('retry')}</Button>
    </div>}
    {info?.writable === false && <p className="qoder-cn-card__hint">{t('credentialReadOnly')}</p>}
    {!draft && snapshot.status === 'ready' && <p className="qoder-cn-card__hint">{effective.vpcInstance || t('public')}</p>}
    {draft && <form className="qoder-cn-card__form" onSubmit={event => { event.preventDefault(); void submit() }}>
      <label className="qoder-cn-card__field" htmlFor={`${id}-pat`}>
        <span>{t('pat')}</span>
        <input id={`${id}-pat`} type="password" autoComplete="new-password" spellCheck={false}
          value={draft.pat} disabled={busy || readOnly || !info?.writable}
          aria-describedby={`${id}-pat-hint`}
          onChange={event => { setDraft({ ...draft, pat: event.target.value }) }} />
        <span id={`${id}-pat-hint`} className="qoder-cn-card__hint">{t('patHint')}</span>
      </label>
      <label className="qoder-cn-card__field" htmlFor={`${id}-vpc`}>
        <span>{t('vpc')}</span>
        <input id={`${id}-vpc`} type="text" autoComplete="off" spellCheck={false}
          value={draft.vpcInstance} disabled={busy || readOnly} aria-describedby={`${id}-vpc-hint`}
          onChange={event => { setDraft({ ...draft, vpcInstance: event.target.value }) }} />
        <span id={`${id}-vpc-hint`} className="qoder-cn-card__hint">{t('vpcHint')}</span>
      </label>
      <details className="qoder-cn-card__advanced">
        <summary>{t('advanced')}</summary>
        <div className="qoder-cn-card__form">
          <label className="qoder-cn-card__field" htmlFor={`${id}-gateway`}>
            <span>{t('gateway')}</span>
            <input id={`${id}-gateway`} type="url" autoComplete="off" spellCheck={false}
              value={draft.baseURL} disabled={busy || readOnly} aria-describedby={`${id}-endpoint-hint`}
              onChange={event => { setDraft({ ...draft, baseURL: event.target.value }) }} />
          </label>
          <label className="qoder-cn-card__field" htmlFor={`${id}-openapi`}>
            <span>{t('openApi')}</span>
            <input id={`${id}-openapi`} type="url" autoComplete="off" spellCheck={false}
              value={draft.openApiUrl} disabled={busy || readOnly} aria-describedby={`${id}-endpoint-hint`}
              onChange={event => { setDraft({ ...draft, openApiUrl: event.target.value }) }} />
          </label>
          <p id={`${id}-endpoint-hint`} className="qoder-cn-card__hint">{t('endpointHint')}</p>
        </div>
      </details>
      <div className="qoder-cn-card__feedback" aria-live="polite">
        {failure && <p className="qoder-cn-card__error" role="alert">{t(failure)}</p>}
        {partial && <p className="qoder-cn-card__hint">{t('partial')}</p>}
      </div>
      <footer className="qoder-cn-card__actions">
        <Button variant="outline" disabled={busy} onClick={() => {
          setDraft(undefined)
          setFailure(undefined)
          setPartial(false)
        }}>{t(partial ? 'close' : 'cancel')}</Button>
        <Button variant="primary" type="submit" disabled={busy || readOnly || failure === 'conflict' || (!!draft.pat.trim() && !info?.writable)}>
          {t(busy ? 'saving' : 'save')}
        </Button>
      </footer>
    </form>}
  </section>
}
