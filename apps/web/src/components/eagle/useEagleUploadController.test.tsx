import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { LibraryWorkspaceProvider } from '../../lib/library-workspace';
import { useEagleUploadController } from './useEagleUploadController';
const { material, photo } = vi.hoisted(() => ({ material: vi.fn(), photo: vi.fn() }));
vi.mock('../../lib/eagle-api', () => ({
  uploadEagleAsset: material,
  createEagleApi: (mode: string) => ({ uploadEagleAsset: mode === 'PHOTO' ? photo : material }),
}));
it('pins every file of a drag batch to the mode at drop time, including queued files after switching modes', async () => {
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  material.mockImplementation(() => gate);
  photo.mockResolvedValue({});
  let mode: 'MATERIAL' | 'PHOTO' = 'MATERIAL';
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <LibraryWorkspaceProvider ownerId="owner" libraryMode={mode}>
        {children}
      </LibraryWorkspaceProvider>
    </QueryClientProvider>
  );
  const view = renderHook(() => useEagleUploadController('', ['eagle', 'owner', mode, 'assets']), {
    wrapper,
  });
  const files = ['a', 'b', 'c'].map(
    (name) => new File(['jpeg'], `${name}.jpg`, { type: 'image/jpeg' }),
  );
  let pending!: Promise<void>;
  act(() => {
    pending = view.result.current.importFiles(files);
  });
  expect(material).toHaveBeenCalledTimes(2);
  mode = 'PHOTO';
  view.rerender();
  await act(async () => {
    release();
    await pending;
  });
  expect(material).toHaveBeenCalledTimes(3);
  expect(photo).not.toHaveBeenCalled();
  await act(async () => {
    await view.result.current.importFiles([files[0]]);
  });
  expect(photo).toHaveBeenCalledOnce();
});
