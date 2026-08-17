import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EagleColorPalette } from './EagleColorPalette';

describe('EagleColorPalette', () => {
  it('renders extracted colors as read-only weighted swatches', () => {
    render(
      <EagleColorPalette
        analysis={{
          assetRevision: 1,
          processorVersion: 'v1',
          status: 'COMPLETED',
          lastError: null,
          completedAt: '2026-08-14T12:00:00.000Z',
          swatches: [
            { rank: 0, hex: '#112233', weight: 0.75, labL: 10, labA: 1, labB: 2 },
            { rank: 1, hex: '#abcdef', weight: 0.25, labL: 80, labA: 0, labB: -1 },
          ],
        }}
      />,
    );

    expect(screen.getByLabelText('提取颜色 #112233，占比 75%')).toBeInTheDocument();
    expect(screen.getByLabelText('提取颜色 #abcdef，占比 25%')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('distinguishes waiting and failed analysis states', () => {
    const { rerender } = render(<EagleColorPalette analysis={null} />);
    expect(screen.getByText('等待颜色分析')).toBeInTheDocument();
    rerender(
      <EagleColorPalette
        analysis={{
          assetRevision: 1,
          processorVersion: 'v1',
          status: 'FAILED',
          lastError: 'decoder failed',
          completedAt: null,
          swatches: [],
        }}
      />,
    );
    expect(screen.getByText('颜色分析失败')).toBeInTheDocument();
  });
});
