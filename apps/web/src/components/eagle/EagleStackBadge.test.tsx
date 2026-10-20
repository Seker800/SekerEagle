import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { EagleStackBadge } from './EagleStackBadge';
afterEach(cleanup);
it('shows a persistent, accessible stack count only when multiple photos are visible', () => {
  const view = render(<EagleStackBadge count={1} />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  view.rerender(<EagleStackBadge count={3} />);
  expect(screen.getByRole('img', { name: '照片组，共 3 张' })).toHaveTextContent('3');
  view.rerender(<EagleStackBadge count={0} />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
