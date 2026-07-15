import { sha256 } from 'js-sha256';
import { checkPhoto, confirmUpload, createUploadSession, uploadPhotoBytes } from '@solar/api/photos';

export async function uploadPhotoFile(args: {
  file: File;
  siteId: string;
  assessmentId?: string;
  fieldName: string;
}): Promise<string> {
  const bytes = await args.file.arrayBuffer();
  const checksum = sha256(bytes);
  const check = await checkPhoto({
    checksum,
    siteId: args.siteId,
    assessmentId: args.assessmentId,
    fieldName: args.fieldName,
  });
  if (check.exists && check.remoteUrl) return check.remoteUrl;

  const session = await createUploadSession({
    checksum,
    siteId: args.siteId,
    assessmentId: args.assessmentId,
    fieldName: args.fieldName,
    filename: args.file.name,
    fileSizeBytes: args.file.size,
  });
  if (session.alreadyExists && session.remoteUrl) return session.remoteUrl;
  if (!session.uploadUrl) throw new Error('Upload URL missing');

  await uploadPhotoBytes(session.uploadUrl, bytes, args.file.type || 'image/jpeg');
  const confirmed = await confirmUpload({ sessionId: session.sessionId, checksum });
  return confirmed.remoteUrl;
}
