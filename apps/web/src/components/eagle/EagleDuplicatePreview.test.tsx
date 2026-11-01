import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EagleDuplicatePreview } from './EagleDuplicatePreview';
import type { DuplicateGroupSummary } from '../../lib/eagle-duplicates-api';
import { MediaLoadScheduler } from '../media/loading/mediaLoadScheduler';
import type { ThumbnailLoadService } from '../media/loading/thumbnailLoadService';
const mocks = vi.hoisted(() => ({ descriptor: vi.fn().mockResolvedValue(null) }));
vi.mock('../../lib/library-workspace', () => ({
  useLibraryWorkspace: () => ({
    ownerId: 'test',
    libraryMode: 'PHOTO',
    api: { getEaglePyramidDescriptor: mocks.descriptor },
  }),
}));
vi.mock('./EagleAssetThumbnail', () => ({ EagleAssetThumbnail: () => <span>thumbnail</span> }));
vi.mock('./eagle-media-sources', () => ({ getEaglePreviewContentUrl: () => '/preview.webp' }));
vi.mock('./EagleImageViewer', () => ({
  EagleImageViewer: ({
    onClose,
    image,
    navigation,
  }: {
    onClose: () => void;
    image: { alt: string };
    navigation: { previous?: () => void; next?: () => void };
  }) => (
    <div role="dialog" aria-label="preview">
      <span>{image.alt}</span>
      <button disabled={!navigation.previous} onClick={navigation.previous}>
        previous
      </button>
      <button disabled={!navigation.next} onClick={navigation.next}>
        next
      </button>
      <button onClick={onClose}>close</button>
    </div>
  ),
}));
describe('direct duplicate comparison', () => {
  it('zooms directly, navigates previews, changes keepers and opens remaining members', async () => {
    const onKeep = vi.fn(),
      onMore = vi.fn();
    const group = {
      signature: 'a',
      recommendedId: 'one',
      count: 4,
      kind: 'EXACT',
      removableBytes: 1000,
      previews: ['one', 'two', 'three'].map((id, index) => ({
        id,
        displayName: id,
        originalName: index ? undefined : 'one.jpg',
        format: 'jpeg',
        byteSize: index ? undefined : 1000,
        width: 1200,
        height: 800,
        mediaRevision: 1,
        rating: index ? null : 5,
        photoMetadata: index ? null : { capturedAt: '2020-01-01' },
      })),
    } as unknown as DuplicateGroupSummary;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const show = (selection?: { keepIds?: string[]; removeIds?: string[] }, ignored = false) => (
      <QueryClientProvider client={client}>
        <EagleDuplicatePreview
          group={group}
          index={0}
          selection={selection}
          disabled={false}
          ignored={ignored}
          scheduler={new MediaLoadScheduler()}
          loadService={{} as ThumbnailLoadService}
          scopeRevision="public"
          onKeep={onKeep}
          onMore={onMore}
        />
      </QueryClientProvider>
    );
    const view = render(show());
    expect(screen.getByRole('button', { name: '保留 one' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: '保留 two' }));
    expect(onKeep).toHaveBeenCalledWith('two');
    fireEvent.click(screen.getByRole('button', { name: '查看其余 1 张' }));
    expect(onMore).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '放大比较 two' }));
    await waitFor(() => expect(mocks.descriptor).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toHaveTextContent('two');
    fireEvent.click(screen.getByRole('button', { name: 'previous' }));
    expect(screen.getByRole('button', { name: 'previous' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    expect(screen.getByRole('button', { name: 'next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    view.rerender(show({ keepIds: ['two'] }));
    expect(screen.getByRole('button', { name: '保留 two' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    view.rerender(show({ removeIds: ['two'] }, true));
    expect(screen.getByRole('button', { name: '保留 two' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: '保留 one' })).toBeDisabled();
  });
});
