/**
 * Browser half: a Plugins-settings card for the `llm-qoder` namespace.
 * @module dsh-provider-qoder/client
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { QoderCard } from './QoderCard.tsx'
import { QODER_NS, QoderCardController } from './controller.ts'
import { en, zh } from './locales.ts'

export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

const LOCALE = 'settings.qoder'

/**
 * Register the Qoder card into Settings → Plugins.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const { api } = ctx.get('connection') as ConnectionHandle
  ctx.effect(() => ctx.locale.register(LOCALE, { zh, en }), 'dsh-provider-qoder: card dictionaries')
  const card = new QoderCardController(ctx.settingsScope.bind({ namespace: QODER_NS }), api)
  ctx.effect(
    () => ctx.remote.$on('credentials/updated', (ref: string) => { card.refreshCredential(ref) }),
    'dsh-provider-qoder: credential invalidations',
  )
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: QODER_NS,
    locale: LOCALE,
    inject: () => card.inject(),
  }, QoderCard))
}
