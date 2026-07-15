'use client';

import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { completeAssessment, deleteAssessment } from '@solar/api/assessments';
import { resolvePhotoUrl } from '@solar/api/photos';
import { useAssessment } from '@solar/hooks/useAssessments';
import { Button } from '@solar/components/ui/Button';
import { DealBreakerFlag, RAGBadge, StatusBadge, ViabilityBadge } from '@solar/components/ui/Badges';
import { Card, ErrorBanner, PageHeader, Spinner } from '@solar/components/ui/Card';
import { cloudConnectionErrorMessage } from '@solar/api/client';
import { useState } from 'react';


function asId(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}


function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-[var(--text-sub)]">{label}</dt>
      <dd className="text-sm text-[var(--text)]">{value}</dd>
    </div>
  );
}

export default function AssessmentDetailPage() {
  const params = useParams();
  const siteId = asId(params.siteId);
  const assessmentId = asId(params.assessmentId);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { data: assessment, isLoading, error: loadError } = useAssessment(siteId, assessmentId);

  if (!siteId || !assessmentId) return <ErrorBanner message="Assessment not found." />;
  if (isLoading) return <Spinner />;
  if (loadError) return <ErrorBanner message={cloudConnectionErrorMessage(loadError)} />;
  if (!assessment) return <ErrorBanner message="Assessment not found." />;

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['assessment', siteId, assessmentId] });
    await queryClient.invalidateQueries({ queryKey: ['assessments', siteId] });
  }

  async function handleComplete() {
    try {
      await completeAssessment(siteId!, assessmentId!);
      await refresh();
    } catch (e) {
      setError(cloudConnectionErrorMessage(e));
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this assessment?')) return;
    try {
      await deleteAssessment(siteId!, assessmentId!, true);
      router.push(`/solar/sites/${siteId}`);
    } catch (e) {
      setError(cloudConnectionErrorMessage(e));
    }
  }

  const aerial = resolvePhotoUrl(assessment.aerialPhotoUri);
  const msb = resolvePhotoUrl(assessment.msbPhotoUri);

  return (
    <div>
      <PageHeader
        title={assessment.buildingIdName}
        subtitle={assessment.siteName}
        actions={
          <>
            <StatusBadge status={assessment.status} />
            <ViabilityBadge value={assessment.viabilityStatus} />
            <RAGBadge value={assessment.ragPriority} />
            <Link href={`/solar/sites/${siteId}/assessments/${assessmentId}/edit`}><Button>Edit</Button></Link>
            {assessment.status !== 'Completed' ? (
              <Button variant="secondary" onClick={() => void handleComplete()}>Mark complete</Button>
            ) : null}
            <Button variant="danger" onClick={() => void handleDelete()}>Delete</Button>
          </>
        }
      />
      {error ? <div className="mb-4"><ErrorBanner message={error} /></div> : null}

      <div className="mb-3 flex flex-wrap gap-2">
        <DealBreakerFlag active={assessment.heritageDealBreaker} label="Heritage deal breaker" />
        <DealBreakerFlag active={assessment.structuralRiskFlag} label="Structural risk" />
        <DealBreakerFlag active={assessment.asbestosFlag} label="Asbestos" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Heritage & roof</h2>
          <dl className="space-y-2">
            <DetailRow label="Heritage status" value={assessment.heritageStatus} />
            <DetailRow label="Roof area total (m²)" value={assessment.roofAreaTotalM2} />
            <DetailRow label="Roof area usable (m²)" value={assessment.roofAreaUsableM2} />
            <DetailRow label="Roof material" value={assessment.roofMaterial} />
            <DetailRow label="Framing type" value={assessment.roofFramingType} />
            <DetailRow label="Pitch angle" value={assessment.roofPitchAngle} />
            <DetailRow label="Construction material" value={assessment.roofConstructionMaterial} />
            <DetailRow label="Condition" value={assessment.roofCondition} />
            <DetailRow label="Estimated age" value={assessment.roofEstimatedAge} />
            <DetailRow label="Orientation" value={assessment.roofOrientationPrimary} />
            <DetailRow label="Shading sources" value={assessment.roofShadingSources} />
            <DetailRow label="Shading usable %" value={assessment.roofShadingUsablePct} />
            <DetailRow label="Structural feasibility" value={assessment.structuralFeasibility} />
            <DetailRow label="PV size kW DC" value={assessment.pvSizeKwDc} />
            <DetailRow label="AC export kW" value={assessment.acExportKw} />
            <DetailRow label="Access / safety constraints" value={assessment.accessSafetyConstraints} />
          </dl>
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Electrical & viability</h2>
          <dl className="space-y-2">
            <DetailRow label="MSB details" value={assessment.msbDetails} />
            <DetailRow label="Existing generation" value={assessment.existingGeneration} />
            <DetailRow label="Distance to connection (m)" value={assessment.distanceToConnectionM} />
            <DetailRow label="Electrical pits / entry" value={assessment.electricalPitsEntry} />
            <DetailRow label="Inverter siting" value={assessment.inverterSiting} />
            <DetailRow label="Transformer capacity" value={assessment.transformerSupplyCapacity} />
            <DetailRow label="DNSP constraints" value={assessment.dnspConstraints} />
            <DetailRow label="Load profile / metering" value={assessment.loadProfileMetering} />
            <DetailRow label="Site rep feedback" value={assessment.siteRepFeedback} />
            <DetailRow label="Deal breaker reason" value={assessment.dealBreakerReason} />
            <DetailRow label="Key assumptions / gaps" value={assessment.keyAssumptionsGaps} />
          </dl>
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Photos</h2>
          <div className="grid grid-cols-2 gap-3">
            {aerial ? <img src={aerial} alt="Aerial" className="rounded-lg" /> : null}
            {msb ? <img src={msb} alt="MSB" className="rounded-lg" /> : null}
            {assessment.switchboards.map((sb, i) =>
              sb.photoUri ? (
                <img key={i} src={resolvePhotoUrl(sb.photoUri) ?? ''} alt={`Switchboard ${i + 1}`} className="rounded-lg" />
              ) : null,
            )}
            {assessment.additionalPhotos.map((uri, i) => (
              <img key={uri + i} src={resolvePhotoUrl(uri) ?? ''} alt={`Additional ${i + 1}`} className="rounded-lg" />
            ))}
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">Switchboards</h2>
          {assessment.switchboards.length === 0 ? (
            <p className="text-sm text-[var(--text-sub)]">None recorded.</p>
          ) : (
            <div className="space-y-3">
              {assessment.switchboards.map((sb, i) => (
                <div key={i} className="rounded-lg border border-[var(--border)] p-3 text-sm">
                  <p className="font-medium">{sb.panelNameId || `Switchboard ${i + 1}`}</p>
                  <DetailRow label="Location" value={sb.locationInBuilding} />
                  <DetailRow label="Voltage" value={sb.incomingSupplyVoltage} />
                  <DetailRow label="Breaker rating" value={sb.mainBreakerRating} />
                  <DetailRow label="Spare breakers" value={sb.spareBreakers} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
