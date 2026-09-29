'use client';

import { useState } from 'react';
import { cloudConnectionErrorMessage } from '@/api/client';
import { uploadPhotoFile } from '@/lib/photoUpload';
import { auditProtocolErrorMessage } from '@/lib/auditProtocol';
import type { AuditWriteGuard } from '@/types/domain';

export function usePhotoUpload() {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(args: {
    file: File;
    auditId: string;
    fieldName: string;
    entityId?: string;
    entityType?: string;
    guard: AuditWriteGuard;
  }): Promise<{ url: string | null; error: string | null }> {
    setUploading(true);
    setError(null);
    try {
      const url = await uploadPhotoFile(args);
      return { url, error: null };
    } catch (e) {
      const message = auditProtocolErrorMessage(e) ?? cloudConnectionErrorMessage(e);
      setError(message);
      return { url: null, error: message };
    } finally {
      setUploading(false);
    }
  }

  return { upload, uploading, error };
}
