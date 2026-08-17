import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EagleColorFilter } from './EagleColorFilter';

describe('EagleColorFilter', () => {
  it('accepts RGB input and emits a canonical searchable color', () => {
    const onChange = vi.fn();
    render(<EagleColorFilter value={undefined} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('颜色值'), { target: { value: 'rgb(46, 134, 171)' } });
    fireEvent.click(screen.getByRole('button', { name: '应用颜色' }));

    expect(onChange).toHaveBeenCalledWith('#2e86ab');
  });

  it('can choose a preset and clear the active color', () => {
    const onChange = vi.fn();
    const { rerender } = render(<EagleColorFilter value={undefined} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '选择红色' }));
    expect(onChange).toHaveBeenCalledWith('#e5484d');

    rerender(<EagleColorFilter value="#e5484d" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '清除颜色筛选' }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});

