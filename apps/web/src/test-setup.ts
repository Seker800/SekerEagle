import '@testing-library/jest-dom/vitest';

window.localStorage.setItem('sekereagle.locale.v1', 'zh-CN');
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
