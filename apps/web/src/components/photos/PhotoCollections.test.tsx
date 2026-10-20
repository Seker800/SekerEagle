import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { PhotoCollections } from './PhotoCollections';
import { PhotoPrivatePeopleSettings } from './PhotoPrivatePeopleSettings';
const mocks = vi.hoisted(() => ({ list: vi.fn(), privacy: vi.fn(), clear: vi.fn() }));
vi.mock('../../lib/photo-management-api', () => ({
  listPhotoPeople: mocks.list,
  updatePhotoPersonPrivacy: mocks.privacy,
  scanPhotoPeople: vi.fn(),
  renamePhotoPerson: vi.fn(),
  mergePhotoPeople: vi.fn(),
  splitPhotoFace: vi.fn(),
}));
vi.mock('../../lib/media-resolver', () => ({
  getDesktopCacheBridge: () => ({ clearCache: mocks.clear }),
}));
function wrapper(node: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {node}
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({
    runtimeConfigured: true,
    people: [
      { id: 'person', name: '测试人物', rowVersion: 3, marksAssetsPrivate: false, faces: [] },
    ],
  });
  mocks.privacy.mockResolvedValue({});
  mocks.clear.mockResolvedValue(undefined);
});
it('人物私密写入当前版本，清除缓存并刷新整个隐私范围', async () => {
  const changed = vi.fn();
  wrapper(
    <PhotoCollections
      includePrivate={false}
      onPrivacyRulesChange={changed}
      onOpen={vi.fn()}
      onPerson={vi.fn()}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '测试人物' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '包含此人的照片设为私密' }));
  await waitFor(() =>
    expect(mocks.privacy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'person', rowVersion: 3 }),
      true,
    ),
  );
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(mocks.clear).toHaveBeenCalledOnce();
  expect(await screen.findByText('已设为私密，开启显示隐私内容后可管理。')).toBeInTheDocument();
});
it('写入失败不伪造成功，并允许重试', async () => {
  mocks.privacy.mockRejectedValueOnce(new Error('人物已变化'));
  const changed = vi.fn();
  wrapper(
    <PhotoCollections
      includePrivate
      onPrivacyRulesChange={changed}
      onOpen={vi.fn()}
      onPerson={vi.fn()}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '测试人物' }));
  fireEvent.click(screen.getByRole('checkbox'));
  expect(await screen.findByRole('alert')).toHaveTextContent('人物已变化');
  expect(changed).not.toHaveBeenCalled();
});
it('关闭隐私显示时不读取私密人物设置，开启后可解除规则', async () => {
  const changed = vi.fn();
  const view = wrapper(
    <PhotoPrivatePeopleSettings includePrivate={false} onRulesChange={changed} />,
  );
  expect(mocks.list).not.toHaveBeenCalled();
  expect(screen.getByText('开启显示隐私内容后，可在这里解除私密人物规则。')).toBeInTheDocument();
  view.unmount();
  mocks.list.mockResolvedValue({
    people: [
      { id: 'person', name: '测试人物', rowVersion: 4, marksAssetsPrivate: true, faces: [] },
    ],
  });
  wrapper(<PhotoPrivatePeopleSettings includePrivate onRulesChange={changed} />);
  fireEvent.click(await screen.findByRole('button', { name: '解除人物私密' }));
  await waitFor(() =>
    expect(mocks.privacy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'person', rowVersion: 4 }),
      false,
    ),
  );
  expect(changed).toHaveBeenCalledOnce();
});
