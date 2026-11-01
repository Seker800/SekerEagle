import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acquireWorkspaceRefresh,
  workspaceRefreshKey,
  type WorkspaceRefreshObservation,
} from './workspace-refresh';
import { t } from '../i18n';

export function WorkspaceRefresh({
  ownerId,
  includePrivate,
}: {
  ownerId: string;
  includePrivate: boolean;
}) {
  const client = useQueryClient();
  useEffect(
    () => acquireWorkspaceRefresh(client, ownerId, includePrivate),
    [client, ownerId, includePrivate],
  );
  const observation = useQuery<WorkspaceRefreshObservation>({
    queryKey: workspaceRefreshKey(ownerId, includePrivate),
    enabled: false,
  });
  return observation.data?.error ? (
    <p role="status">{t('自动更新暂时不可用，现有结果已保留。')}</p>
  ) : null;
}
