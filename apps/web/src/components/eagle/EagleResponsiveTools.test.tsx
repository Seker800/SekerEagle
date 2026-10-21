import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EagleResponsiveTools } from './EagleResponsiveTools';
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => vi.unstubAllGlobals());
it('puts phone controls behind a sheet and keeps their state after closing', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  function Example() {
    const [value, setValue] = useState(180);
    return <EagleResponsiveTools scopeKey="owner:mode" panel={<p>shared filters</p>}>
      <input aria-label="size" type="range" min="140" max="320" value={value} onChange={(event) => setValue(Number(event.target.value))} />
    </EagleResponsiveTools>;
  }
  render(<Example />);
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '视图与筛选' }));
  fireEvent.change(screen.getByRole('slider'), { target: { value: '210' } });
  expect(screen.getByText('shared filters')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '完成' }));
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '视图与筛选' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: '视图与筛选' }));
  expect(screen.getByRole('slider')).toHaveValue('210');
});
it('keeps desktop controls inline without adding a mobile launcher', () => {
  render(<EagleResponsiveTools scopeKey="one"><button>desktop control</button></EagleResponsiveTools>);
  expect(screen.getByRole('button', { name: 'desktop control' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '视图与筛选' })).not.toBeInTheDocument();
});
it('closes phone tools when the account or mode changes', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  const view = render(<EagleResponsiveTools scopeKey="one"><button>control</button></EagleResponsiveTools>);
  fireEvent.click(screen.getByRole('button', { name: '视图与筛选' }));
  view.rerender(<EagleResponsiveTools scopeKey="two"><button>control</button></EagleResponsiveTools>);
  expect(screen.queryByRole('dialog', { name: '视图与筛选' })).not.toBeInTheDocument();
});
