import { useMutation } from '@tanstack/react-query';
import { fetchClient } from '../../api';


const uploadFinished = (formData: FormData) => 
    fetchClient.post('/upload/complete/', formData)

export const useUploadFinishedMutation = () => useMutation({
        mutationFn: uploadFinished,
    });
