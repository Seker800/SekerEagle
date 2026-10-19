import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { EagleLivePhotoPlayback } from './EagleLivePhotoPlayback';
describe('EagleLivePhotoPlayback', () => {
  it('loads motion only after a click, returns to still, and resets when changing images', () => {
    const view = render(<EagleLivePhotoPlayback sourceUrl="motion.mp4" posterUrl="still.webp" />);
    expect(view.container.querySelector('video')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '播放实况' }));
    const video = screen.getByLabelText('播放实况');
    expect(video).toHaveAttribute('src', 'motion.mp4');
    expect(video).toHaveAttribute('poster', 'still.webp');
    fireEvent.ended(video);
    expect(view.container.querySelector('video')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '播放实况' }));
    fireEvent.error(screen.getByLabelText('播放实况'));
    expect(screen.getByRole('alert')).toHaveTextContent('实况播放失败');
    fireEvent.click(screen.getByRole('button', { name: '播放实况' }));
    fireEvent.click(screen.getByRole('button', { name: '返回静态照片' }));
    fireEvent.click(screen.getByRole('button', { name: '播放实况' }));
    view.rerender(<EagleLivePhotoPlayback sourceUrl="other.mp4" posterUrl="other.webp" />);
    expect(view.container.querySelector('video')).toBeNull();
    view.rerender(<EagleLivePhotoPlayback posterUrl="other.webp" />);
    expect(view.container).toBeEmptyDOMElement();
  });
});
