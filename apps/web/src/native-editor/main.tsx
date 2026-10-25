import { createRoot } from 'react-dom/client';
import { NativeEditorApp } from './NativeEditorApp';
import './native-editor.css';

declare global {
  interface Window {
    EditorHost: { request(id: number, action: string, payload: string): void };
    editorReply: (id: number, result: { value?: unknown; error?: string }) => void;
  }
}
let sequence = 0;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (reason: Error) => void }
>();
window.editorReply = (id, result) => {
  const entry = pending.get(id);
  pending.delete(id);
  if (result.error) entry?.reject(new Error(result.error));
  else entry?.resolve(result.value);
};
function request<T>(action: string, payload: unknown = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve: (value) => resolve(value as T), reject });
    window.EditorHost.request(id, action, JSON.stringify(payload));
  });
}
createRoot(document.getElementById('root')!).render(<NativeEditorApp request={request} />);
