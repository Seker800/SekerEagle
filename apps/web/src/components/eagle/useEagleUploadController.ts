import { useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { mapWithConcurrency } from '../../lib/async-pool';
import { uploadEagleAsset } from '../../lib/eagle-api';

const EAGLE_IMPORT_CONCURRENCY = 2;

export function useEagleUploadController(accessToken: string, assetsQueryKey: QueryKey) {
  const queryClient = useQueryClient();
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  const importFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploadStatus(null);
    let completed = 0;
    const results = await mapWithConcurrency(files, EAGLE_IMPORT_CONCURRENCY, async (file) => {
      try {
        await uploadEagleAsset(accessToken, file, (progress) => {
          setUploadStatus(
            `正在并行导入 · 已完成 ${completed}/${files.length} · ${file.name} ${progress.percent}%`,
          );
        });
        return { error: null };
      } catch (error) {
        return {
          error: `${file.name}: ${error instanceof Error ? error.message : '导入失败'}`,
        };
      } finally {
        completed += 1;
        setUploadStatus(`正在并行导入 · 已完成 ${completed}/${files.length}`);
      }
    });
    const failures = results.flatMap((result) => (result.error ? [result.error] : []));
    const uploaded = results.length - failures.length;
    await queryClient.invalidateQueries({ queryKey: assetsQueryKey });
    setUploadStatus(
      failures.length > 0 ? `完成 ${uploaded}/${files.length}，${failures[0]}` : null,
    );
  };

  return { importFiles, uploadStatus };
}
