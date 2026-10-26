import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { TaskQueueBrowser } from './TaskQueueBrowser';
import type { TaskGroup } from '@sekereagle/library-core';
const group = {
  id: 'EMBEDDING',
  background: true,
  queued: 2,
  running: 0,
  failed: 0,
  completed: 0,
  approval: 0,
  waiting: [],
  steps: [],
} as TaskGroup;
const schedule = { mode: 'ALWAYS', nightStart: '23:00', nightEnd: '06:00' };
it('keeps quantities aligned, selects details and filters without hiding work in another source', () => {
  render(
    <TaskQueueBrowser
      items={[
        { mode: 'PHOTO', group, schedule },
        { mode: 'MATERIAL', group: { ...group, id: 'COLOR', running: 1 }, schedule },
      ]}
      renderDetails={(item) => (
        <article>
          {item.mode}:{item.group.id}
        </article>
      )}
    />,
  );
  expect(screen.getAllByRole('row')).toHaveLength(3);
  expect(screen.getByRole('article')).toHaveTextContent('PHOTO:EMBEDDING');
  fireEvent.click(screen.getByRole('button', { name: /代表色提取/ }));
  expect(screen.getByRole('article')).toHaveTextContent('MATERIAL:COLOR');
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '2B' } });
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
  expect(screen.getByRole('article')).toHaveTextContent('PHOTO:EMBEDDING');
});

it('honors an explicit server reason of null for a partly blocked group and filters by state', () => {
  const mixed: TaskGroup = {
    ...group,
    waiting: [{ reason: 'MODEL_OFFLINE', count: 1, nextAt: null }],
    presentation: { status: 'QUEUED', section: 'IMMEDIATE', reason: null },
  };
  render(
    <TaskQueueBrowser
      items={[{ mode: 'PHOTO', group: mixed, schedule }]}
      renderDetails={() => <article>details</article>}
    />,
  );
  expect(
    within(screen.getByRole('table')).queryByText('等待 Mac 2B 模型上线'),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'RUNNING' } });
  expect(screen.getByText('未找到匹配任务')).toBeVisible();
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ALL' } });
  expect(screen.getByRole('article')).toBeVisible();
});

it('shows completed quantities directly in history without empty live columns', () => {
  render(
    <TaskQueueBrowser
      history
      items={[{ mode: 'PHOTO', group: { ...group, queued: 0, completed: 4321 }, schedule }]}
      renderDetails={() => <article>details</article>}
    />,
  );
  const table = within(screen.getByRole('table'));
  expect(table.getByRole('columnheader', { name: '已完成' })).toBeVisible();
  expect(table.getByRole('cell', { name: '4321' })).toBeVisible();
  expect(table.queryByRole('columnheader', { name: '排队' })).not.toBeInTheDocument();
});
