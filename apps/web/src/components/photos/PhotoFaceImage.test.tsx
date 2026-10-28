import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { facePreview, PhotoFaceImage, representativeFace } from './PhotoFaceImage';
import type { PhotoFace, PhotoPerson } from '../../lib/photo-management-api';

function face(box = [0.2, 0.2, 0.1, 0.2]): PhotoFace {
  return {
    id: 'face',
    box,
    confidence: 0.99,
    assetId: 'photo',
    asset: {
      id: 'photo',
      mimeType: 'image/jpeg',
      mediaRevision: 1,
      width: 4000,
      height: 3000,
      renditions: [
        {
          id: 'thumb',
          kind: 'THUMBNAIL',
          mimeType: 'image/jpeg',
          revision: 1,
          width: 256,
          height: 192,
        },
        {
          id: 'preview',
          kind: 'PREVIEW',
          mimeType: 'image/jpeg',
          revision: 1,
          width: 1600,
          height: 1200,
        },
      ],
    },
  } as PhotoFace;
}
it('优先当前浏览预览并回退缩略图，不修改 API 原始顺序', () => {
  const sample = face();
  expect(facePreview(sample.asset)?.id).toBe('preview');
  expect(sample.asset.renditions[0]?.id).toBe('thumb');
  sample.asset.renditions.pop();
  expect(facePreview(sample.asset)?.id).toBe('thumb');
});
it('头像优先用可见人脸像素更多的照片', () => {
  const small = face();
  const large = { ...face([0.1, 0.1, 0.5, 0.6]), id: 'large', confidence: 0.8 };
  const person = { faces: [small, large] } as PhotoPerson;
  expect(representativeFace(person)?.id).toBe('large');
  expect(person.faces[0]?.id).toBe('face');
  expect(representativeFace({ faces: [] } as unknown as PhotoPerson)).toBeUndefined();
});
it('人脸按源图片的像素比例裁成方形，不把长脸强行压扁', () => {
  render(<PhotoFaceImage face={face()} url={() => '/preview'} alt="人脸" />);
  const image = screen.getByAltText('人脸') as HTMLImageElement;
  const ratio = parseFloat(image.style.width) / parseFloat(image.style.height);
  expect(ratio).toBeCloseTo(4 / 3);
});
it('没有可读图片时显示占位，不请求原件', () => {
  const view = render(<PhotoFaceImage face={face()} url={() => null} />);
  expect(view.container.querySelector('.photo-face-crop')).toBeInTheDocument();
  expect(view.container.querySelector('img')).toBeNull();
});
it('尺寸缺失时沿用原片比例，零框不会产生无穷大尺寸', () => {
  const sample = face([0, 0, 0, 0]);
  sample.asset.renditions = [];
  render(<PhotoFaceImage face={sample} url={() => '/fallback'} alt="fallback" />);
  const image = screen.getByAltText('fallback');
  expect(image.getAttribute('style')).not.toMatch(/NaN|Infinity/);
});
it('只用当前图片浏览预览，排除实况视频、RAW 编辑大图与旧版本', () => {
  const sample = face();
  sample.asset.mediaRevision = 2;
  sample.asset.mimeType = 'image/jpeg';
  sample.asset.renditions = [
    {
      id: 'motion',
      kind: 'PREVIEW',
      variant: 'motion',
      mimeType: 'video/mp4',
      revision: 2,
      width: 4000,
      height: 3000,
      byteSize: 100,
    },
    {
      id: 'edit',
      kind: 'PREVIEW',
      variant: 'edit',
      mimeType: 'image/webp',
      revision: 2,
      width: 6000,
      height: 4000,
      byteSize: 100,
    },
    {
      id: 'old',
      kind: 'PREVIEW',
      variant: 'default',
      mimeType: 'image/jpeg',
      revision: 1,
      width: 4000,
      height: 3000,
      byteSize: 100,
    },
    {
      id: 'browse',
      kind: 'PREVIEW',
      variant: 'default',
      mimeType: 'image/jpeg',
      revision: 2,
      width: 1600,
      height: 1200,
      byteSize: 100,
    },
  ];
  expect(facePreview(sample.asset)?.id).toBe('browse');
  sample.asset.renditions.pop();
  expect(facePreview(sample.asset)).toBeUndefined();
});
