import type { Sharp } from 'sharp';

const MAX_AI_TAGS = 10;
const AI_TAG_IMAGE_MAX_SIZE = 960;

const BLOCKED_TAGS = new Set([
  '图片',
  '图像',
  '照片',
  '画面',
  '场景',
  '设计',
  '元素',
  '物体',
  '背景',
  '漂亮',
  '美丽',
  '好看',
  '高级',
  '精致',
  '现代',
  '红色',
  '橙色',
  '黄色',
  '绿色',
  '蓝色',
  '紫色',
  '粉色',
  '黑色',
  '白色',
  '灰色',
  '棕色',
]);

export const AI_NOUN_TAG_PROMPT = `识别图片中明确可见、能帮助搜索的具体实体、场所或内容类型。
只输出简短中文名词或名词短语，例如“汽车”“办公椅”“手机界面”。
不要输出颜色；不要输出漂亮、高级、现代等主观形容词；不要输出图片、画面、背景、设计、元素等空泛词；不要猜测图片中不可见的身份、情绪或用途。
同一概念不要重复，不要为了凑数量而输出上位词。最多十个，不足十个就少写，没有可靠标签时返回空数组。
必须严格输出 JSON 对象，格式为 {"tags":["标签1","标签2"]}，不要使用 Markdown，不要输出其他文字。`;

export async function renderAiTagInput(source: Sharp): Promise<Buffer> {
  return source
    .rotate()
    .toColourspace('srgb')
    .resize({
      width: AI_TAG_IMAGE_MAX_SIZE,
      height: AI_TAG_IMAGE_MAX_SIZE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 85 })
    .toBuffer();
}

export function parseConcreteNounTags(input: unknown): string[] {
  if (!input || typeof input !== 'object' || !('tags' in input)) return [];
  const tags = (input as { tags?: unknown }).tags;
  if (!Array.isArray(tags)) return [];
  const unique = new Map<string, string>();
  for (const value of tags) {
    if (typeof value !== 'string') continue;
    const name = value
      .normalize('NFKC')
      .trim()
      .replace(/[，,。.!！?？;；]+$/u, '');
    const normalized = name.toLocaleLowerCase('zh-CN');
    if (!name || name.length > 32 || BLOCKED_TAGS.has(normalized) || unique.has(normalized))
      continue;
    unique.set(normalized, name);
    if (unique.size >= MAX_AI_TAGS) break;
  }
  return [...unique.values()];
}

interface OllamaVisionClientOptions {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

export class OllamaVisionClient {
  private readonly request: typeof fetch;

  constructor(private readonly options: OllamaVisionClientOptions) {
    this.request = options.fetch ?? fetch;
  }

  async tagImage(bytes: Buffer): Promise<string[]> {
    const response = await this.request(`${this.options.baseUrl.replace(/\/+$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(this.options.timeoutMs),
      body: JSON.stringify({
        model: this.options.model,
        stream: false,
        think: false,
        format: {
          type: 'object',
          properties: { tags: { type: 'array', items: { type: 'string' }, maxItems: MAX_AI_TAGS } },
          required: ['tags'],
        },
        options: { temperature: 0, num_ctx: 4096, num_predict: 128 },
        messages: [
          { role: 'user', content: AI_NOUN_TAG_PROMPT, images: [bytes.toString('base64')] },
        ],
      }),
    });
    if (!response.ok) throw new Error(`OLLAMA_HTTP_${response.status}`);
    const payload = (await response.json()) as { message?: { content?: unknown } };
    if (typeof payload.message?.content !== 'string') throw new Error('OLLAMA_INVALID_RESPONSE');
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload.message.content);
    } catch {
      throw new Error('OLLAMA_INVALID_JSON');
    }
    return parseConcreteNounTags(parsed);
  }
}
