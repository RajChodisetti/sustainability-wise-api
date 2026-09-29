'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { PhotoThumb } from '@/components/photos/PhotoThumb';
import { PhotoMetadataControls } from '@/components/photos/PhotoField';
import {
  normalizePhotoMetadata,
  normalizePhotoMetadataMap,
  setPhotoMetadata,
  type PhotoMetadataMap,
} from '@/lib/photoMetadata';

export type PdfPhotoEntry = {
  key: string;
  uri: string;
  defaultLabel: string;
};

export function PhotoMetadataManager({
  photos,
  initialMetadata,
  readOnly,
  onSave,
}: {
  photos: PdfPhotoEntry[];
  initialMetadata: unknown;
  readOnly?: boolean;
  onSave: (metadata: PhotoMetadataMap) => Promise<void>;
}) {
  const controlId = useId().replaceAll(':', '');
  const [metadata, setMetadata] = useState<PhotoMetadataMap>(() => normalizePhotoMetadataMap(initialMetadata));
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    setBusy(true);
    try {
      await onSave(metadata);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="font-semibold">Photos and PDF settings</h2>
        <p className="mt-1 text-sm text-[var(--text-sub)]">
          {readOnly
            ? 'Photo captions and PDF layout are read-only here. Create or open the authorised editable audit to change them.'
            : 'Rename each photo caption and choose whether it uses a large or compact layout in the PDF.'}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {photos.map((photo, index) => {
          const value = normalizePhotoMetadata(metadata[photo.key]);
          return (
            <div key={`${photo.key}-${photo.uri}`} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface2)]">
              <PhotoThumb
                uri={photo.uri}
                label={value.name?.trim() || photo.defaultLabel}
                className="aspect-[4/3] w-full border-0 object-cover"
              />
              <PhotoMetadataControls
                id={`${controlId}-${index}`}
                defaultLabel={photo.defaultLabel}
                value={value}
                disabled={busy || readOnly}
                onChange={(next) => setMetadata((current) => setPhotoMetadata(current, photo.key, next))}
              />
            </div>
          );
        })}
      </div>
      {!readOnly ? <div className="mt-4 flex justify-end">
        <Button onClick={() => void handleSave()} disabled={busy} aria-busy={busy}>
          {busy ? 'Saving PDF photo settings…' : 'Save PDF photo settings'}
        </Button>
      </div> : null}
    </div>
  );
}
