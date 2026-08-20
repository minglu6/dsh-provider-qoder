/** Locale keys for the Qoder plugin card. */
export type QoderLocaleKey =
  | 'title'
  | 'description'
  | 'pat'
  | 'patHint'
  | 'patSet'
  | 'patUnset'
  | 'vpc'
  | 'vpcHint'
  | 'save'
  | 'saving'
  | 'discard'
  | 'unsaved'
  | 'saveFailed'
  | 'readOnly'
  | 'expand'
  | 'collapse'

/** English copy. */
export const en: Record<QoderLocaleKey, string> = {
  title: 'qoder-cn',
  description: 'Qoder CN PAT and optional enterprise VPC.',
  pat: 'Personal access token',
  patHint: 'A Qoder PAT starting with pt-. Leave blank to keep the stored token.',
  patSet: 'Configured',
  patUnset: 'Not configured',
  vpc: 'VPC instance',
  vpcHint: 'Optional. Enterprise host such as tenant.vpc.qoder.com.cn. Leave blank for public cloud.',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  unsaved: 'Unsaved',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  readOnly: 'This deployment stores settings read-only.',
  expand: 'Show settings',
  collapse: 'Hide settings',
}

/** Chinese copy. */
export const zh: Record<QoderLocaleKey, string> = {
  title: 'qoder-cn',
  description: 'Qoder CN 个人访问令牌，以及可选的企业 VPC。',
  pat: '个人访问令牌',
  patHint: '以 pt- 开头的 Qoder PAT。留空则保留已保存的令牌。',
  patSet: '已配置',
  patUnset: '未配置',
  vpc: 'VPC 实例',
  vpcHint: '可选。企业主机，例如 tenant.vpc.qoder.com.cn。留空使用公有云。',
  save: '保存',
  saving: '保存中…',
  discard: '放弃',
  unsaved: '未保存',
  saveFailed: '部署未接受这些值，已留给你修改。',
  readOnly: '此部署的设置为只读。',
  expand: '显示设置',
  collapse: '隐藏设置',
}
