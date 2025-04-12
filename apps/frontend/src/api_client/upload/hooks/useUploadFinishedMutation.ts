import { useMutation } from '@tanstack/react-query';
import { fetchClient } from '../../api';
import { UploadOptions } from '../types';


const uploadFinished = (formData: FormData) => 
    fetchClient.post('/upload/complete/', formData)

export const useUploadFinishedMutation = (options: UploadOptions) => {
    return useMutation({
        mutationFn: () => uploadFinished(options.form_data),
    });
};
