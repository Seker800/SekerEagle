import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { EagleLibraryNavigation } from './EagleLibraryNavigation';

it('preserves navigation content state when the compact drawer is closed and reopened', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  const show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
  const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
  HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  HTMLDialogElement.prototype.close = function() { this.open = false; };
  function Contents() { const [count, setCount] = useState(0); return <button onClick={() => setCount(count + 1)}>expanded {count}</button>; }
  const view = render(<EagleLibraryNavigation label="nav" header={null} className="nav" headerClassName="header" scopeKey="owner:mode" activeKey="all"><Contents /></EagleLibraryNavigation>);
  try {
    fireEvent.click(screen.getByRole('button', { name: '打开导航' }));
    fireEvent.click(screen.getByRole('button', { name: 'expanded 0' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭导航' }));
    fireEvent.click(screen.getByRole('button', { name: '打开导航' }));
    expect(screen.getByRole('button', { name: 'expanded 1' })).toBeInTheDocument();
  } finally {
    view.unmount();
    for (const [name, descriptor] of [['showModal', show], ['close', close]] as const) {
      if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
    }
    vi.unstubAllGlobals();
  }
});
