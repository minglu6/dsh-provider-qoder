import { useState, type CSSProperties } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { QoderCardFace } from './controller.ts'

/** Props the renderer binds for the Qoder plugin card. */
export type QoderCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.qoder'>
  & InjectFace<QoderCardFace>

const cardStyle: CSSProperties = {
  listStyle: 'none',
  border: '1px solid var(--dsw-alias-border-subtle, #d0d0d0)',
  borderRadius: 8,
  padding: 0,
  margin: '0 0 12px',
  overflow: 'hidden',
}
const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  padding: '12px 16px',
  border: 0,
  background: 'transparent',
  cursor: 'pointer',
  textAlign: 'left',
}
const nameStyle: CSSProperties = { fontWeight: 600, display: 'block' }
const descStyle: CSSProperties = { opacity: 0.7, fontSize: 13, display: 'block' }
const bodyStyle: CSSProperties = { padding: '0 16px 16px', display: 'grid', gap: 12 }
const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 500 }
const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--dsw-alias-border-subtle, #d0d0d0)',
}
const hintStyle: CSSProperties = { fontSize: 12, opacity: 0.7, margin: 0 }
const footerStyle: CSSProperties = { display: 'flex', gap: 8, justifyContent: 'flex-end' }

/**
 * Render the Qoder plugin card.
 * @param props - locale, snapshot hook, and form actions.
 * @returns the card, or nothing when the Host does not serve `llm-qoder`.
 */
export function QoderCard(props: QoderCardProps) {
  const { t } = props
  const state = props.useQoderCard(snapshot => snapshot)
  const [open, setOpen] = useState(true)
  if (!state.available) return null
  const title = t('title')
  return (
    <li style={cardStyle}>
      <button
        type="button"
        style={headerStyle}
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${title}`}
        onClick={() => { setOpen(!open) }}
      >
        <span>
          <span style={nameStyle}>{title}</span>
          <span style={descStyle}>{t('description')}</span>
        </span>
        {state.dirty ? <span style={{ marginLeft: 'auto', fontSize: 12 }}>{t('unsaved')}</span> : null}
      </button>
      {open
        ? (
          <div style={bodyStyle}>
            {!state.writable ? <p role="status">{t('readOnly')}</p> : null}
            <div>
              <label style={labelStyle} htmlFor="qoder-pat">{t('pat')}</label>
              <input
                id="qoder-pat"
                style={inputStyle}
                type="password"
                autoComplete="off"
                value={state.pat}
                disabled={!state.patWritable}
                placeholder={state.patConfigured ? t('patSet') : t('patUnset')}
                onChange={(event) => { props.editPat(event.target.value) }}
              />
              <p style={hintStyle}>{t('patHint')}</p>
            </div>
            <div>
              <label style={labelStyle} htmlFor="qoder-vpc">{t('vpc')}</label>
              <input
                id="qoder-vpc"
                style={inputStyle}
                type="text"
                autoComplete="off"
                value={state.vpc}
                disabled={!state.writable}
                onChange={(event) => { props.editVpc(event.target.value) }}
              />
              <p style={hintStyle}>{t('vpcHint')}</p>
            </div>
            {state.failed ? <p role="status">{t('saveFailed')}</p> : null}
            <div style={footerStyle}>
              <button type="button" disabled={!state.dirty || state.saving} onClick={props.discard}>
                {t('discard')}
              </button>
              <button
                type="button"
                disabled={!state.dirty || state.saving || (!state.writable && state.pat.trim().length === 0)}
                onClick={props.save}
              >
                {state.saving ? t('saving') : t('save')}
              </button>
            </div>
          </div>
        )
        : null}
    </li>
  )
}
