/** Register the Qoder Models-page card and its disposable styles and translations. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-remotes/types'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type {} from '@deepseek-ai/dsh-credentials/types'
import { QoderCard } from './QoderCard.tsx'
import { en, zh, type CopyKey } from './locales.ts'
import { settingsNamespace, type Operations, type QoderConfig } from './operations.ts'
import css from './card.css'

const localeNamespace = 'settings.qoderCn'
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.qoderCn': CopyKey
  }
}

/** Client services required by the credential card. */
export const inject = ['slots', 'locale', 'configForms', 'remote', 'remote.settings', 'remote.credentials']

/**
 * Mount the plugin-owned Models-page footer card.
 * @param ctx - Client plugin context sharing the Host's settings and credential APIs.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(localeNamespace, { en, zh }), 'qoder-cn: card locales')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-provider-qoder'
    style.textContent = css
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'qoder-cn: card styles')
  const form = ctx.configForms.get<QoderConfig>(settingsNamespace)
  const operations: Operations = {
    describe: async ref => {
      const response = await ctx.remote.credentials.describe([ref])
      return response.ok ? response.value[ref] : undefined
    },
    mutate: (ops, revision) => ctx.remote.settings.mutate(settingsNamespace, ops, revision),
    store: async (ref, pat) => {
      const response = await ctx.remote.credentials.set(ref, pat)
      return response.ok
    },
    subscribeCredentials: listener => {
      const disposers = [
        ctx.remote.$on('credentials/reference-updated', listener),
        ctx.remote.$on('credentials/record-updated', listener),
        ctx.on('connection/reset', listener),
      ]
      return () => { for (const dispose of disposers) dispose() }
    },
  }
  ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
    name: 'settings.models.footer',
    id: 'qoder-cn-connection',
    order: 20,
    locale: localeNamespace,
    inject: () => ({ form, operations }),
  }, QoderCard))
}
