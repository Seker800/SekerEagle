import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { it, expect, vi } from 'vitest';
import { PhotoPeopleReview } from './PhotoPeopleReview';
const mocks = vi.hoisted(() => ({ suggest: vi.fn(), decide: vi.fn() }));
vi.mock('../../lib/photo-management-api', () => ({
  getPhotoPeopleReview: mocks.suggest,
  decidePhotoPeople: mocks.decide,
}));
it('never invents a comparison when the server has no candidate', async () => {
  mocks.suggest.mockResolvedValue({ items: [], nextCursor: null });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PhotoPeopleReview
        ownerId="owner"
        includePrivate={false}
        pending={false}
        onChanged={vi.fn()}
        onOpen={vi.fn()}
        preview={() => null}
      />
    </QueryClientProvider>,
  );
  await screen.findByText('暂时没有需要确认的相似人物。');
  expect(screen.queryByRole('button', { name: '是，同一个人' })).not.toBeInTheDocument();
  expect(mocks.suggest).toHaveBeenCalled();
});
