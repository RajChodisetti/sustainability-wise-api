import { useMemo, useState } from 'react';
import type { RooftopAssessment } from '@solar/types/domain';
import {
  buildSitePackInventory,
  countIncludedPhotos,
  createDefaultReportOptions,
  type SitePackReportOptions,
} from '@solar/lib/reportConfig';
import { Button } from '@solar/components/ui/Button';

export function SitePackReportModal({
  open,
  siteName,
  assessments,
  onClose,
  onGenerate,
  busy,
}: {
  open: boolean;
  siteName: string;
  assessments: RooftopAssessment[];
  onClose: () => void;
  onGenerate: (options: SitePackReportOptions, assessmentIds: string[]) => void;
  busy?: boolean;
}) {
  const [options, setOptions] = useState(() => createDefaultReportOptions(assessments));
  const inventory = useMemo(() => buildSitePackInventory(assessments), [assessments]);
  const photoCount = countIncludedPhotos(options, inventory);

  if (!open) return null;

  function toggleAssessment(id: string) {
    const next = new Set(options.includedAssessmentIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOptions({ ...options, includedAssessmentIds: next });
  }

  function togglePhoto(uri: string) {
    const next = new Set(options.includedPhotoUris);
    if (next.has(uri)) next.delete(uri);
    else next.add(uri);
    setOptions({ ...options, includedPhotoUris: next });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl bg-[var(--surface)] p-6 shadow-xl">
        <h2 className="text-xl font-bold text-[var(--text)]">Generate Site Pack PDF</h2>
        <p className="mt-1 text-sm text-[var(--text-sub)]">{siteName}</p>

        <div className="mt-4 space-y-4">
          <section>
            <h3 className="text-sm font-semibold text-[var(--text)]">Buildings</h3>
            <div className="mt-2 space-y-2">
              {assessments.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={options.includedAssessmentIds.has(a.id)}
                    onChange={() => toggleAssessment(a.id)}
                  />
                  {a.buildingIdName}
                </label>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-[var(--text)]">Photos ({photoCount} selected)</h3>
            <div className="mt-2 max-h-48 space-y-2 overflow-auto">
              {inventory
                .filter((g) => options.includedAssessmentIds.has(g.assessmentId))
                .flatMap((g) => g.photos.map((p) => ({ ...p, buildingName: g.buildingName })))
                .map((p) => (
                  <label key={p.uri} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={options.includedPhotoUris.has(p.uri)}
                      onChange={() => togglePhoto(p.uri)}
                    />
                    <span className="truncate">{p.buildingName} — {p.label}</span>
                  </label>
                ))}
            </div>
          </section>

          <section className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={options.includeRagFramework}
                onChange={(e) => setOptions({ ...options, includeRagFramework: e.target.checked })}
              />
              Include RAG framework
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={options.includeAppendix}
                onChange={(e) => setOptions({ ...options, includeAppendix: e.target.checked })}
              />
              Include appendix
            </label>
          </section>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            onClick={() =>
              onGenerate(
                options,
                assessments.filter((a) => options.includedAssessmentIds.has(a.id)).map((a) => a.id),
              )
            }
            disabled={busy || options.includedAssessmentIds.size === 0}
          >
            {busy ? 'Generating…' : 'Generate PDF'}
          </Button>
        </div>
      </div>
    </div>
  );
}
