import { resolvePhotoUrl } from '@solar/api/photos';
import { Button } from '@solar/components/ui/Button';
import { FieldError } from '@solar/components/ui/FormFields';
import { useToast } from '@/contexts/ToastContext';
import { usePhotoUpload } from '@solar/hooks/usePhotoUpload';

export function PhotoField({
  label,
  uri,
  siteId,
  assessmentId,
  fieldName,
  onChange,
  disabled,
}: {
  label: string;
  uri?: string | null;
  siteId: string;
  assessmentId?: string;
  fieldName: string;
  onChange: (uri: string | null) => void;
  disabled?: boolean;
}) {
  const { upload, uploading, error } = usePhotoUpload();
  const toast = useToast();
  const src = resolvePhotoUrl(uri);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const result = await upload({ file, siteId, assessmentId, fieldName });
    if (result.url) {
      onChange(result.url);
      toast.success(`${label} uploaded successfully.`);
    } else if (result.error) {
      toast.error(result.error);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <p className="mb-2 text-sm font-medium text-[var(--text)]">{label}</p>
      {src ? (
        <img src={src} alt={label} className="mb-2 max-h-48 w-full rounded-lg object-cover" />
      ) : (
        <div className="mb-2 flex h-32 items-center justify-center rounded-lg bg-[var(--surface2)] text-sm text-[var(--muted)]">
          No photo
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <label className="cursor-pointer">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={disabled || uploading}
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
          <span className="inline-flex rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-fg)]">
            {uploading ? 'Uploading…' : src ? 'Replace' : 'Upload'}
          </span>
        </label>
        {src ? (
          <Button variant="ghost" className="!px-3 !py-1.5 !text-xs" onClick={() => onChange(null)} disabled={disabled}>
            Remove
          </Button>
        ) : null}
      </div>
      <FieldError message={error ?? undefined} />
    </div>
  );
}

export function PhotoGridField({
  label,
  uris,
  siteId,
  assessmentId,
  fieldPrefix,
  onChange,
  disabled,
}: {
  label: string;
  uris: string[];
  siteId: string;
  assessmentId?: string;
  fieldPrefix: string;
  onChange: (uris: string[]) => void;
  disabled?: boolean;
}) {
  const { upload, uploading, error } = usePhotoUpload();
  const toast = useToast();

  async function handleAdd(file: File | undefined) {
    if (!file) return;
    const result = await upload({
      file,
      siteId,
      assessmentId,
      fieldName: `${fieldPrefix}_${uris.length}`,
    });
    if (result.url) {
      onChange([...uris, result.url]);
      toast.success('Photo uploaded successfully.');
    } else if (result.error) {
      toast.error(result.error);
    }
  }

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-[var(--text)]">{label}</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {uris.map((uri, i) => {
          const src = resolvePhotoUrl(uri);
          return (
            <div key={`${uri}-${i}`} className="relative overflow-hidden rounded-lg border border-[var(--border)]">
              {src ? <img src={src} alt="" className="aspect-square w-full object-cover" /> : null}
              {!disabled ? (
                <button
                  type="button"
                  className="absolute right-1 top-1 rounded bg-black/60 px-2 py-0.5 text-xs text-white"
                  onClick={() => onChange(uris.filter((_, idx) => idx !== i))}
                >
                  ×
                </button>
              ) : null}
            </div>
          );
        })}
        {!disabled ? (
          <label className="flex aspect-square cursor-pointer items-center justify-center rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface2)] text-xs text-[var(--text-sub)]">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => void handleAdd(e.target.files?.[0])}
            />
            {uploading ? 'Uploading…' : '+ Add photo'}
          </label>
        ) : null}
      </div>
      <FieldError message={error ?? undefined} />
    </div>
  );
}
