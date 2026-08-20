/**
 * Serialize harness messages into the Qoder CN wire vocabulary (OpenAI-style
 * roles with `content` strings / content parts and `tool_calls`), ported from
 * the pi provider extension. The chat endpoint expects the OpenAI-compatible
 * shape inside the agent-chat envelope; image content crosses as data URLs.
 *
 * @module dsh-llm-qoder/serialize
 */

import { contentHasImage, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type { AttachmentStore, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'

/** OpenAI-style tool definition sent to the Qoder API. */
interface QoderTool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: unknown
  }
}

/** OpenAI-style tool call within an assistant message. */
interface QoderToolCall {
  id?: string
  type: 'function'
  function: { name?: string; arguments: string }
}

type QoderTextPart = { type: 'text'; text: string }
type QoderImagePart = { type: 'image_url'; image_url: { url: string } }
type QoderContent = string | Array<QoderTextPart | QoderImagePart>

/** OpenAI-style message sent to the Qoder API. */
export interface QoderMessage {
  role: 'user' | 'assistant' | 'tool'
  content: QoderContent | null
  tool_calls?: QoderToolCall[]
  tool_call_id?: string
}

/** Flatten harness blocks to their visible text (text only). */
function getBlocksText(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Flatten text recursively, including nested tool-result content. */
function flattenBlocksText(blocks: readonly ContentBlock[]): string {
  return blocks.map((block) => {
    if (block.type === 'text') return block.text
    if (block.type === 'tool-result') return flattenBlocksText(block.content)
    return ''
  }).join('')
}

/**
 * Convert harness tool schemas to the wire shape.
 * @param options - the assembled request.
 * @returns the wire tools, or `undefined` when none are declared.
 */
export function transformTools(options: GenerateOptions): QoderTool[] | undefined {
  return options.tools !== undefined && options.tools.length > 0
    ? options.tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))
    : undefined
}

async function userContent(
  blocks: readonly ContentBlock[],
  attachments: AttachmentStore | undefined,
): Promise<QoderContent> {
  if (!contentHasImage(blocks)) return flattenBlocksText(blocks)

  const content: (QoderTextPart | QoderImagePart)[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        if (block.text.length > 0) content.push({ type: 'text', text: block.text })
        break
      case 'image': {
        if (attachments === undefined) {
          throw new LlmError(
            'Qoder CN image content requires the durable attachment service',
            'UNSUPPORTED_CONTENT',
          )
        }
        const stored: StoredImageAttachment = await attachments.readImage(block.attachment)
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString('base64')}`,
          },
        })
        break
      }
      case 'tool-result': {
        const nested = await userContent(block.content, attachments)
        if (typeof nested !== 'string') content.push(...nested)
        else content.push({ type: 'text', text: nested })
        break
      }
      default:
        break
    }
  }
  return content
}

/**
 * Convert the harness conversation to wire messages. User messages carry text
 * plus optional images; assistant messages carry text, thinking tags, and tool
 * calls; tool results become role `tool` entries.
 * @param options - the assembled request (history, tools).
 * @param attachments - optional durable byte resolver for image references.
 * @returns the wire messages in order.
 */
export async function serializeMessages(
  options: GenerateOptions,
  attachments?: AttachmentStore,
): Promise<QoderMessage[]> {
  const normalizedMessages: QoderMessage[] = []

  for (const msg of options.messages) {
    if (msg.role === 'user') {
      const regular = msg.content.filter(block => block.type !== 'tool-result')
      const content = await userContent(regular, attachments)
      const results = msg.content.filter(block => block.type === 'tool-result')
      if (content !== '' || results.length === 0) {
        normalizedMessages.push({ role: 'user', content })
      }
      for (const result of results) {
        const resultContent = await userContent(result.content, attachments)
        normalizedMessages.push({
          role: 'tool',
          tool_call_id: result.toolCallId,
          content: typeof resultContent === 'string'
            ? resultContent || '(no output)'
            : resultContent,
        })
      }
      continue
    }

    if (msg.role === 'assistant') {
      let content = ''
      const toolCalls: QoderToolCall[] = []
      for (const block of msg.content) {
        if (block.type === 'text') {
          content += block.text
        } else if (block.type === 'reasoning') {
          content += `<thinking>${block.text}</thinking>\n\n`
        } else if (block.type === 'tool-call') {
          const call: QoderToolCall = {
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: block.arguments,
            },
          }
          toolCalls.push(call)
        }
      }
      const mapped: QoderMessage = { role: 'assistant', content: content || null }
      if (toolCalls.length > 0) {
        mapped.tool_calls = toolCalls
      }
      normalizedMessages.push(mapped)
      continue
    }

    // system role: the harness sends the system prompt via options.system;
    // fold any in-history system message into the user stream to preserve order.
    const text = getBlocksText(msg.content)
    if (text.length > 0) normalizedMessages.push({ role: 'user', content: text })
  }

  return normalizedMessages
}

/**
 * Build the `chat_context` original-content text (last user text).
 * @param messages - the harness conversation, in order.
 * @returns the last non-empty user text, or an empty string.
 */
export function lastUserText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg !== undefined && msg.role === 'user') {
      return getBlocksText(msg.content.filter(block => block.type !== 'tool-result'))
    }
  }
  return ''
}
