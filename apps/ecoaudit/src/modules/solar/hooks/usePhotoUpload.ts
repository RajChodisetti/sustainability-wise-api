import { useState } from 'react';
import { cloudConnectionErrorMessage } from '@solar/api/client';
import { uploadPhotoFile } from '@solar/lib/photoUpload';

export function usePhotoUpload() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(args: {
    file: File;
    siteId: string;
    assessmentId?: string;
    fieldName: string;
  }): Promise<{ url: string | null; error: string | null }> {
    setUploading(true);
    setError(null);
    try {
      const url = await uploadPhotoFile(args);
      return { url, error: null };
    } catch (e) {
      const message = cloudConnectionErrorMessage(e);
      setError(message);
      return { url: null, error: message };
    } finally {
      setUploading(false);
    }
  }

  return { upload, uploading, error };
}
