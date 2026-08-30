import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { OllamaVisionClient, parseConcreteNounTags, renderAiTagInput } from './ai-tagging';

test('AI tag output keeps at most ten concrete noun phrases and removes obvious garbage', () => {
  assert.deepEqual(
    parseConcreteNounTags({
      tags: [
        ' 汽车 ',
        '道路',
        '红色',
        '漂亮',
        '图片',
        '汽车',
        '建筑',
        '行人',
        '路灯',
        '商店招牌',
        '斑马线',
        '自行车',
        '交通信号灯',
        '公交车',
        '天空',
      ],
    }),
    [
      '汽车',
      '道路',
      '建筑',
      '行人',
      '路灯',
      '商店招牌',
      '斑马线',
      '自行车',
      '交通信号灯',
      '公交车',
    ],
  );
});

test('Ollama vision request uses the noun-only JSON contract', async () => {
  let body: Record<string, unknown> | undefined;
  const client = new OllamaVisionClient({
    baseUrl: 'http://host.docker.internal:11434',
    model: 'qwen3-vl:8b-instruct',
    timeoutMs: 1_000,
    fetch: async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const requestBody = init?.body;
      assert.equal(typeof requestBody, 'string');
      body = JSON.parse(requestBody as string) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ message: { content: JSON.stringify({ tags: ['汽车', '道路'] }) } }),
      );
    },
  });

  const result = await client.tagImage(Buffer.from('preview'));

  assert.deepEqual(result, ['汽车', '道路']);
  assert.equal(body?.model, 'qwen3-vl:8b-instruct');
  assert.equal(body?.think, false);
  assert.deepEqual(body?.options, {
    temperature: 0,
    num_ctx: 4096,
    num_predict: 128,
  });
  assert.deepEqual(body?.format, {
    type: 'object',
    properties: { tags: { type: 'array', items: { type: 'string' }, maxItems: 10 } },
    required: ['tags'],
  });
  assert.match(JSON.stringify(body), /不要输出颜色/);
  assert.match(JSON.stringify(body), /不足十个就少写/);
  assert.match(JSON.stringify(body), /必须严格输出 JSON 对象/);
  assert.match(JSON.stringify(body), /\{\\"tags\\":\[\\"标签1\\",\\"标签2\\"\]\}/);
});

test('AI tag image input is a bounded JPEG with a neutral background', async () => {
  const transparentWebp = await sharp({
    create: { width: 1_600, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .webp()
    .toBuffer();

  const rendered = await renderAiTagInput(sharp(transparentWebp));
  const { data, info } = await sharp(rendered).raw().toBuffer({ resolveWithObject: true });

  assert.equal(info.format, 'raw');
  assert.equal(info.width, 960);
  assert.equal(info.height, 480);
  assert.equal(info.channels, 3);
  assert.ok(data[0]! >= 250 && data[1]! >= 250 && data[2]! >= 250);
});
