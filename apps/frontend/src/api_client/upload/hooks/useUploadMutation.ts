import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { fetchClient } from '../../api';
import { UploadOptions } from '../types';

export const UploadResponse = z.object({
  upload_id: z.string(),
  offset: z.number(),
});

const upload = (options: UploadOptions) => {
    const headers = new Headers({
      'Content-Range': `bytes ${options.offset}-${options.offset + options.chunk_size - 1}/${options.chunk_size}`,
    });
    return fetchClient.request('/upload/', {
      method: 'POST',
      body: options.form_data,
      headers,
    }).then(response => UploadResponse.parse(response));
    }

export const useUploadMutation = () => useMutation({
        mutationFn: upload,
    });  