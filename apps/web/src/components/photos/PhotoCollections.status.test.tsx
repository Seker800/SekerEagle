import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { PhotoCollections } from './PhotoCollections';

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../lib/photo-management-api', () => ({
  listPhotoPeople: mocks.list,
  listPhotoPersonFaces: vi.fn().mockResolvedValue({ faces: [], nextCursor: null }),
  reviewPhotoPeople: vi.fn().mockResolvedValue({ pairs: [] }),
  scanPhotoPeople: vi.fn(),
  renamePhotoPerson: vi.fn(),
  mergePhotoPeople: vi.fn(),
  splitPhotoFace: vi.fn(),
  updatePhotoPersonPrivacy: vi.fn(),
}));
vi.mock('../../lib/library-workspace', () => ({
  useLibraryWorkspace: () => ({ ownerId: 'owner', api: {} }),
}));
function showPeople() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = {
    includePrivate: false,
    onPrivacyRulesChange: vi.fn(),
    onOpen: vi.fn(),
    onPerson: vi.fn(),
  };
  return render(
    <QueryClientProvider client={client}>
      <PhotoCollections {...props} />
    </QueryClientProvider>,
  );
}
beforeEach(() => vi.clearAllMocks());

it('未配置时只说明识别服务不可用，不让已有照片的用户重新导入', async () => {
  mocks.list.mockResolvedValue({ runtimeConfigured: false, people: [] });
  showPeople();
  expect(await screen.findByText('人物识别服务尚未配置，暂时无法分析照片。')).toHaveAttribute(
    'role',
    'status',
  );
  expect(screen.getByRole('button', { name: '分析人物' })).toBeDisabled();
  expect(screen.queryByText(/导入照片后/)).not.toBeInTheDocument();
  expect(screen.queryByText(/可点击“分析人物”/)).not.toBeInTheDocument();
});
it('配置完成但没有人物结果时提示分析现有图库', async () => {
  mocks.list.mockResolvedValue({ runtimeConfigured: true, people: [] });
  showPeople();
  expect(
    await screen.findByText('暂无人物。可点击“分析人物”扫描图库中的照片。'),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '分析人物' })).toBeEnabled();
  expect(screen.queryByText(/尚未配置/)).not.toBeInTheDocument();
});
it('加载配置期间不能提前提交分析', () => {
  mocks.list.mockReturnValue(new Promise(() => undefined));
  showPeople();
  expect(screen.getByRole('button', { name: '分析人物' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('正在加载人物…');
  expect(screen.queryByText(/尚未配置|暂无人物/)).not.toBeInTheDocument();
});
it('读取失败只显示错误，不把错误判断成未安装或暂无人物', async () => {
  mocks.list.mockRejectedValue(new Error('读取人物失败'));
  showPeople();
  expect(await screen.findByRole('alert')).toHaveTextContent('读取人物失败');
  expect(screen.getByRole('button', { name: '分析人物' })).toBeDisabled();
  expect(screen.queryByText(/尚未配置|暂无人物/)).not.toBeInTheDocument();
});
it('模型未配置也能继续浏览以前已经识别的人物', async () => {
  mocks.list.mockResolvedValue({
    runtimeConfigured: false,
    people: [{ id: 'person', name: '已有人物', faces: [] }],
  });
  showPeople();
  expect(await screen.findByRole('button', { name: '已有人物' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '分析人物' })).toBeDisabled();
});
