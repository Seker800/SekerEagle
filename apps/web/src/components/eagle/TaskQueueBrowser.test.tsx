import {fireEvent, render, screen, within} from '@testing-library/react';
import {expect, it} from 'vitest';
import {TaskQueueBrowser} from './TaskQueueBrowser';
import type {TaskGroup} from '@sekereagle/library-core';
const group = {id: 'EMBEDDING', background: true, queued: 2, running: 0, failed: 0, completed: 0, approval: 0, waiting: [], steps: []} as TaskGroup;
const schedule = {mode: 'ALWAYS', nightStart: '23:00', nightEnd: '06:00'};
it('keeps quantities aligned, selects details and filters without hiding work in another source', () => {
 render(<TaskQueueBrowser items={[
  {mode: 'PHOTO', group, schedule},
  {mode: 'MATERIAL', group: {...group, id: 'COLOR', running: 1}, schedule},
 ]} renderDetails={(item) => <article>{item.mode}:{item.group.id}</article>} />);
 expect(screen.getAllByRole('row')).toHaveLength(3);
 expect(screen.getByRole('article')).toHaveTextContent('PHOTO:EMBEDDING');
 fireEvent.click(screen.getByRole('button', {name: /代表色提取/}));
 expect(screen.getByRole('article')).toHaveTextContent('MATERIAL:COLOR');
 fireEvent.change(screen.getByRole('searchbox'), {target: {value: '2B'}});
 expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
 expect(screen.getByRole('article')).toHaveTextContent('PHOTO:EMBEDDING');
});
