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
        const result = await uploadEagleAsset(accessToken, file, (progress) => {
          setUploadStatus(
            `正在并行导入 · 已完成 ${completed}/${files.length} · ${file.name} ${progress.percent}%`,
          );
        });
        return { duplicate: result.duplicate, error: null };
      } catch (error) {
        return {
          duplicate: false,
          error: `${file.name}: ${error instanceof Error ? error.message : '导入失败'}`,
        };
      } finally {
        completed += 1;
        setUploadStatus(`正在并行导入 · 已完成 ${completed}/${files.length}`);
      }
    });
    const failures = results.flatMap((result) => (result.error ? [result.error] : []));
    const uploaded = results.length - failures.length;
    const duplicates = results.filter((result) => result.duplicate).length;
    await queryClient.invalidateQueries({ queryKey: assetsQueryKey });
    setUploadStatus(
      failures.length > 0
        ? `完成 ${uploaded}/${files.length}，${failures[0]}`
        : duplicates > 0
          ? `导入完成，跳过 ${duplicates} 个重复素材`
          : `已导入 ${uploaded} 个素材`,
    );
  };

  return { importFiles, uploadStatus };
}
