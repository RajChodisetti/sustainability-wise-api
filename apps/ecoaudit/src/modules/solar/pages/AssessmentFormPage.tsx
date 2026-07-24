'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { createAssessment, getAssessment, updateAssessment } from '@solar/api/assessments';
import { getSite } from '@solar/api/sites';
import type { OtherConsideration, RooftopAssessment, Switchboard } from '@solar/types/domain';
import { PhotoField, PhotoGridField } from '@solar/components/photos/PhotoField';
import {
  normalizePhotoMetadata,
  normalizePhotoMetadataMap,
  removeIndexedPhotoMetadata,
  removePhotoMetadata,
  setPhotoMetadataName,
} from '@solar/lib/photoMetadata';
import { Button } from '@solar/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@solar/components/ui/Card';
import { Checkbox, FieldLabel, Input, Select, Textarea } from '@solar/components/ui/FormFields';
import { cloudConnectionErrorMessage } from '@solar/api/client';


function asId(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}


const emptySwitchboard = (): Switchboard => ({
  panelNameId: '',
  locationInBuilding: '',
  incomingSupplyVoltage: '',
  mainBreakerRating: '',
  spareBreakers: '',
});

export default function AssessmentFormPage() {
  const params = useParams();
  const siteId = asId(params.siteId);
  const assessmentId = asId(params.assessmentId);
  const isEdit = Boolean(assessmentId);

  const siteQuery = useQuery({ queryKey: ['site', siteId], queryFn: () => getSite(siteId!), enabled: Boolean(siteId) });
  const assessmentQuery = useQuery({
    queryKey: ['assessment', siteId, assessmentId],
    queryFn: () => getAssessment(siteId!, assessmentId!),
    enabled: isEdit && Boolean(siteId && assessmentId),
  });

  if (!siteId) return <ErrorBanner message="Site is required." />;
  if (siteQuery.isLoading || (isEdit && assessmentQuery.isLoading)) return <Spinner />;
  if (siteQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(siteQuery.error)} />;
  if (assessmentQuery.error) return <ErrorBanner message={cloudConnectionErrorMessage(assessmentQuery.error)} />;
  if (!siteQuery.data) return <ErrorBanner message="Site not found." />;
  if (isEdit && !assessmentQuery.data) return <ErrorBanner message="Assessment not found." />;

  return (
    <AssessmentEditor
      key={assessmentId ?? 'new'}
      siteId={siteId}
      assessmentId={assessmentId}
      siteName={siteQuery.data.siteName}
      assessment={assessmentQuery.data}
    />
  );
}

function AssessmentEditor({
  siteId,
  assessmentId,
  siteName,
  assessment,
}: {
  siteId: string;
  assessmentId?: string;
  siteName: string;
  assessment?: RooftopAssessment;
}) {
  const isEdit = Boolean(assessmentId);
  const isCompleted = assessment?.status === 'Completed';
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buildingIdName, setBuildingIdName] = useState(assessment?.buildingIdName ?? '');
  const [heritageStatus, setHeritageStatus] = useState(assessment?.heritageStatus ?? '');
  const [heritageDealBreaker, setHeritageDealBreaker] = useState(assessment?.heritageDealBreaker ?? false);
  const [aerialPhotoUri, setAerialPhotoUri] = useState<string | null>(assessment?.aerialPhotoUri ?? null);
  const [msbPhotoUri, setMsbPhotoUri] = useState<string | null>(assessment?.msbPhotoUri ?? null);
  const [roofAreaTotalM2, setRoofAreaTotalM2] = useState(assessment?.roofAreaTotalM2?.toString() ?? '');
  const [roofAreaUsableM2, setRoofAreaUsableM2] = useState(assessment?.roofAreaUsableM2?.toString() ?? '');
  const [roofMaterial, setRoofMaterial] = useState(assessment?.roofMaterial ?? '');
  const [roofFramingType, setRoofFramingType] = useState(assessment?.roofFramingType ?? '');
  const [roofPitchAngle, setRoofPitchAngle] = useState(assessment?.roofPitchAngle ?? '');
  const [roofConstructionMaterial, setRoofConstructionMaterial] = useState(assessment?.roofConstructionMaterial ?? '');
  const [asbestosFlag, setAsbestosFlag] = useState(assessment?.asbestosFlag ?? false);
  const [roofCondition, setRoofCondition] = useState(assessment?.roofCondition ?? '');
  const [roofEstimatedAge, setRoofEstimatedAge] = useState(assessment?.roofEstimatedAge ?? '');
  const [roofOrientationPrimary, setRoofOrientationPrimary] = useState(assessment?.roofOrientationPrimary ?? '');
  const [roofShadingSources, setRoofShadingSources] = useState(assessment?.roofShadingSources ?? '');
  const [roofShadingUsablePct, setRoofShadingUsablePct] = useState(assessment?.roofShadingUsablePct ?? '');
  const roofOrientationShading = assessment?.roofOrientationShading ?? '';
  const [structuralFeasibility, setStructuralFeasibility] = useState(assessment?.structuralFeasibility ?? '');
  const [structuralRiskFlag, setStructuralRiskFlag] = useState(assessment?.structuralRiskFlag ?? false);
  const [pvSizeKwDc, setPvSizeKwDc] = useState(assessment?.pvSizeKwDc?.toString() ?? '');
  const [acExportKw, setAcExportKw] = useState(assessment?.acExportKw?.toString() ?? '');
  const [accessSafetyConstraints, setAccessSafetyConstraints] = useState(assessment?.accessSafetyConstraints ?? '');
  const [switchboards, setSwitchboards] = useState<Switchboard[]>(
    assessment?.switchboards.length ? assessment.switchboards : [emptySwitchboard()],
  );
  const [msbDetails, setMsbDetails] = useState(assessment?.msbDetails ?? '');
  const [existingGeneration, setExistingGeneration] = useState(assessment?.existingGeneration ?? '');
  const [distanceToConnectionM, setDistanceToConnectionM] = useState(assessment?.distanceToConnectionM?.toString() ?? '');
  const [electricalPitsEntry, setElectricalPitsEntry] = useState(assessment?.electricalPitsEntry ?? '');
  const [inverterSiting, setInverterSiting] = useState(assessment?.inverterSiting ?? '');
  const [transformerSupplyCapacity, setTransformerSupplyCapacity] = useState(assessment?.transformerSupplyCapacity ?? '');
  const [dnspConstraints, setDnspConstraints] = useState(assessment?.dnspConstraints ?? '');
  const [loadProfileMetering, setLoadProfileMetering] = useState(assessment?.loadProfileMetering ?? '');
  const otherConsiderations: OtherConsideration[] = assessment?.otherConsiderations ?? [];
  const [siteRepFeedback, setSiteRepFeedback] = useState(assessment?.siteRepFeedback ?? '');
  const [viabilityStatus, setViabilityStatus] = useState(assessment?.viabilityStatus ?? '');
  const [dealBreakerReason, setDealBreakerReason] = useState(assessment?.dealBreakerReason ?? '');
  const [ragPriority, setRagPriority] = useState(assessment?.ragPriority ?? '');
  const [keyAssumptionsGaps, setKeyAssumptionsGaps] = useState(assessment?.keyAssumptionsGaps ?? '');
  const [additionalPhotos, setAdditionalPhotos] = useState<string[]>(assessment?.additionalPhotos ?? []);
  const [photoMetadata, setPhotoMetadata] = useState(
    () => normalizePhotoMetadataMap(assessment?.photoMetadata),
  );


  function numOrNull(v: string) {
    if (!v.trim()) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function buildPayload() {
    return {
      siteName,
      buildingIdName: buildingIdName.trim(),
      heritageStatus: heritageStatus || null,
      heritageDealBreaker,
      aerialPhotoUri,
      msbPhotoUri,
      roofAreaTotalM2: numOrNull(roofAreaTotalM2),
      roofAreaUsableM2: numOrNull(roofAreaUsableM2),
      roofMaterial: roofMaterial || null,
      roofFramingType: roofFramingType || null,
      roofPitchAngle: roofPitchAngle || null,
      roofConstructionMaterial: roofConstructionMaterial || null,
      asbestosFlag,
      roofCondition: roofCondition || null,
      roofEstimatedAge: roofEstimatedAge || null,
      roofOrientationPrimary: roofOrientationPrimary || null,
      roofShadingSources: roofShadingSources || null,
      roofShadingUsablePct: roofShadingUsablePct || null,
      roofOrientationShading: roofOrientationShading || null,
      structuralFeasibility: structuralFeasibility || null,
      structuralRiskFlag,
      pvSizeKwDc: numOrNull(pvSizeKwDc),
      acExportKw: numOrNull(acExportKw),
      accessSafetyConstraints: accessSafetyConstraints || null,
      switchboards,
      msbDetails: msbDetails || null,
      existingGeneration: existingGeneration || null,
      distanceToConnectionM: numOrNull(distanceToConnectionM),
      electricalPitsEntry: electricalPitsEntry || null,
      inverterSiting: inverterSiting || null,
      transformerSupplyCapacity: transformerSupplyCapacity || null,
      dnspConstraints: dnspConstraints || null,
      loadProfileMetering: loadProfileMetering || null,
      otherConsiderations,
      siteRepFeedback: siteRepFeedback || null,
      viabilityStatus: viabilityStatus || null,
      dealBreakerReason: dealBreakerReason || null,
      ragPriority: ragPriority || null,
      keyAssumptionsGaps: keyAssumptionsGaps || null,
      additionalPhotos,
      photoMetadata: normalizePhotoMetadataMap(photoMetadata),
    };
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!buildingIdName.trim()) {
      setError('Building ID / name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = buildPayload();
      const saved = isEdit
        ? await updateAssessment(siteId!, assessmentId!, payload)
        : await createAssessment(siteId!, payload);
      router.push(`/solar/sites/${siteId}/assessments/${saved.id}`);
    } catch (err) {
      setError(cloudConnectionErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function updateSwitchboard(index: number, patch: Partial<Switchboard>) {
    setSwitchboards((prev) => prev.map((sb, i) => (i === index ? { ...sb, ...patch } : sb)));
  }

  function photoCaption(key: string): string {
    return normalizePhotoMetadata(photoMetadata[key]).name ?? '';
  }

  function updatePhotoCaption(key: string, caption: string) {
    setPhotoMetadata((current) => setPhotoMetadataName(current, key, caption));
  }

  function removeSwitchboard(index: number) {
    setSwitchboards((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setPhotoMetadata((current) => removeIndexedPhotoMetadata(current, 'switchboard', index));
  }

  return (
    <div>
      <PageHeader title={isEdit ? 'Edit assessment' : 'New assessment'} subtitle={siteName} />
      <form onSubmit={handleSave} className="max-w-4xl space-y-4">
        <Card>
          <h2 className="mb-2 font-semibold">Building</h2>
          <FieldLabel>Building ID / name *</FieldLabel>
          <Input value={buildingIdName} onChange={(e) => setBuildingIdName(e.target.value)} required disabled={isCompleted} />
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">Heritage</h2>
          <FieldLabel>Heritage status</FieldLabel>
          <Input value={heritageStatus} onChange={(e) => setHeritageStatus(e.target.value)} disabled={isCompleted} />
          <Checkbox label="Heritage deal breaker" checked={heritageDealBreaker} onChange={setHeritageDealBreaker} />
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">Roof</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <div><FieldLabel>Total area (m²)</FieldLabel><Input value={roofAreaTotalM2} onChange={(e) => setRoofAreaTotalM2(e.target.value)} /></div>
            <div><FieldLabel>Usable area (m²)</FieldLabel><Input value={roofAreaUsableM2} onChange={(e) => setRoofAreaUsableM2(e.target.value)} /></div>
            <div><FieldLabel>Material</FieldLabel><Input value={roofMaterial} onChange={(e) => setRoofMaterial(e.target.value)} /></div>
            <div><FieldLabel>Framing type</FieldLabel><Input value={roofFramingType} onChange={(e) => setRoofFramingType(e.target.value)} /></div>
            <div><FieldLabel>Pitch angle</FieldLabel><Input value={roofPitchAngle} onChange={(e) => setRoofPitchAngle(e.target.value)} /></div>
            <div><FieldLabel>Construction material</FieldLabel><Input value={roofConstructionMaterial} onChange={(e) => setRoofConstructionMaterial(e.target.value)} /></div>
            <div><FieldLabel>Condition</FieldLabel>
              <Select value={roofCondition} onChange={(e) => setRoofCondition(e.target.value)}>
                <option value="">—</option>
                <option value="Good">Good</option>
                <option value="Fair">Fair</option>
                <option value="Poor">Poor</option>
              </Select>
            </div>
            <div><FieldLabel>Estimated age</FieldLabel><Input value={roofEstimatedAge} onChange={(e) => setRoofEstimatedAge(e.target.value)} /></div>
            <div><FieldLabel>Orientation</FieldLabel><Input value={roofOrientationPrimary} onChange={(e) => setRoofOrientationPrimary(e.target.value)} /></div>
            <div><FieldLabel>Shading sources</FieldLabel><Input value={roofShadingSources} onChange={(e) => setRoofShadingSources(e.target.value)} /></div>
            <div><FieldLabel>Shading usable %</FieldLabel><Input value={roofShadingUsablePct} onChange={(e) => setRoofShadingUsablePct(e.target.value)} /></div>
            <div><FieldLabel>PV size kW DC</FieldLabel><Input value={pvSizeKwDc} onChange={(e) => setPvSizeKwDc(e.target.value)} /></div>
            <div><FieldLabel>AC export kW</FieldLabel><Input value={acExportKw} onChange={(e) => setAcExportKw(e.target.value)} /></div>
          </div>
          <div className="mt-3 space-y-2">
            <Checkbox label="Asbestos flag" checked={asbestosFlag} onChange={setAsbestosFlag} />
            <Checkbox label="Structural risk flag" checked={structuralRiskFlag} onChange={setStructuralRiskFlag} />
          </div>
          <FieldLabel>Structural feasibility</FieldLabel>
          <Textarea value={structuralFeasibility} onChange={(e) => setStructuralFeasibility(e.target.value)} />
          <FieldLabel>Access / safety constraints</FieldLabel>
          <Textarea value={accessSafetyConstraints} onChange={(e) => setAccessSafetyConstraints(e.target.value)} />
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">Electrical</h2>
          <FieldLabel>MSB details</FieldLabel>
          <Textarea value={msbDetails} onChange={(e) => setMsbDetails(e.target.value)} />
          <div className="grid gap-3 md:grid-cols-2">
            <div><FieldLabel>Existing generation</FieldLabel><Input value={existingGeneration} onChange={(e) => setExistingGeneration(e.target.value)} /></div>
            <div><FieldLabel>Distance to connection (m)</FieldLabel><Input value={distanceToConnectionM} onChange={(e) => setDistanceToConnectionM(e.target.value)} /></div>
            <div><FieldLabel>Inverter siting</FieldLabel><Input value={inverterSiting} onChange={(e) => setInverterSiting(e.target.value)} /></div>
            <div><FieldLabel>Transformer capacity</FieldLabel><Input value={transformerSupplyCapacity} onChange={(e) => setTransformerSupplyCapacity(e.target.value)} /></div>
          </div>
          <FieldLabel>Electrical pits / entry</FieldLabel>
          <Textarea value={electricalPitsEntry} onChange={(e) => setElectricalPitsEntry(e.target.value)} />
          <FieldLabel>DNSP constraints</FieldLabel>
          <Textarea value={dnspConstraints} onChange={(e) => setDnspConstraints(e.target.value)} />
          <FieldLabel>Load profile / metering</FieldLabel>
          <Textarea value={loadProfileMetering} onChange={(e) => setLoadProfileMetering(e.target.value)} />
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Switchboards</h2>
            <Button type="button" variant="secondary" className="!px-3 !py-1.5 !text-xs" onClick={() => setSwitchboards((p) => [...p, emptySwitchboard()])}>
              Add switchboard
            </Button>
          </div>
          {switchboards.map((sb, i) => (
            <div key={i} className="mb-4 rounded-lg border border-[var(--border)] p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">Switchboard {i + 1}</p>
                {switchboards.length > 1 ? (
                  <Button type="button" variant="ghost" className="!px-2 !py-1 !text-xs" onClick={() => removeSwitchboard(i)}>
                    Remove
                  </Button>
                ) : null}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div><FieldLabel>Panel name / ID</FieldLabel><Input value={sb.panelNameId ?? ''} onChange={(e) => updateSwitchboard(i, { panelNameId: e.target.value })} /></div>
                <div><FieldLabel>Location in building</FieldLabel><Input value={sb.locationInBuilding ?? ''} onChange={(e) => updateSwitchboard(i, { locationInBuilding: e.target.value })} /></div>
                <div><FieldLabel>Incoming supply voltage</FieldLabel><Input value={sb.incomingSupplyVoltage ?? ''} onChange={(e) => updateSwitchboard(i, { incomingSupplyVoltage: e.target.value })} /></div>
                <div><FieldLabel>Main breaker rating</FieldLabel><Input value={sb.mainBreakerRating ?? ''} onChange={(e) => updateSwitchboard(i, { mainBreakerRating: e.target.value })} /></div>
                <div><FieldLabel>Spare breakers</FieldLabel><Input value={sb.spareBreakers ?? ''} onChange={(e) => updateSwitchboard(i, { spareBreakers: e.target.value })} /></div>
              </div>
              <div className="mt-3">
                <PhotoField
                  label="Switchboard photo"
                  uri={sb.photoUri}
                  siteId={siteId}
                  assessmentId={assessmentId}
                  fieldName={`switchboard_${i}`}
                  onChange={(uri) => {
                    updateSwitchboard(i, { photoUri: uri ?? undefined });
                    if (!uri) {
                      setPhotoMetadata((current) => removePhotoMetadata(current, `switchboard.${i}.photo`));
                    }
                  }}
                  caption={photoCaption(`switchboard.${i}.photo`)}
                  onCaptionChange={(caption) => updatePhotoCaption(`switchboard.${i}.photo`, caption)}
                  disabled={isCompleted}
                />
              </div>
            </div>
          ))}
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">Photos</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <PhotoField
              label="Aerial photo"
              uri={aerialPhotoUri}
              siteId={siteId}
              assessmentId={assessmentId}
              fieldName="aerial"
              onChange={(uri) => {
                setAerialPhotoUri(uri);
                if (!uri) setPhotoMetadata((current) => removePhotoMetadata(current, 'aerialPhoto'));
              }}
              caption={photoCaption('aerialPhoto')}
              onCaptionChange={(caption) => updatePhotoCaption('aerialPhoto', caption)}
              disabled={isCompleted}
            />
            <PhotoField
              label="MSB photo"
              uri={msbPhotoUri}
              siteId={siteId}
              assessmentId={assessmentId}
              fieldName="msb"
              onChange={(uri) => {
                setMsbPhotoUri(uri);
                if (!uri) setPhotoMetadata((current) => removePhotoMetadata(current, 'msbPhoto'));
              }}
              caption={photoCaption('msbPhoto')}
              onCaptionChange={(caption) => updatePhotoCaption('msbPhoto', caption)}
              disabled={isCompleted}
            />
          </div>
          <div className="mt-4">
            <PhotoGridField
              label="Additional photos"
              uris={additionalPhotos}
              siteId={siteId}
              assessmentId={assessmentId}
              fieldPrefix="additional"
              onChange={setAdditionalPhotos}
              captions={additionalPhotos.map((_, index) => photoCaption(`additionalPhoto.${index}`))}
              onCaptionChange={(index, caption) => updatePhotoCaption(`additionalPhoto.${index}`, caption)}
              onPhotoRemoved={(index) => {
                setPhotoMetadata((current) => removeIndexedPhotoMetadata(current, 'additionalPhoto', index));
              }}
              disabled={isCompleted}
            />
          </div>
        </Card>

        <Card>
          <h2 className="mb-2 font-semibold">Viability & priority</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <FieldLabel>Viability</FieldLabel>
              <Select value={viabilityStatus} onChange={(e) => setViabilityStatus(e.target.value)}>
                <option value="">—</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
                <option value="TBD">TBD</option>
              </Select>
            </div>
            <div>
              <FieldLabel>RAG priority</FieldLabel>
              <Select value={ragPriority} onChange={(e) => setRagPriority(e.target.value)}>
                <option value="">—</option>
                <option value="Green">Green</option>
                <option value="Amber">Amber</option>
                <option value="Red">Red</option>
              </Select>
            </div>
          </div>
          <FieldLabel>Deal breaker reason</FieldLabel>
          <Textarea value={dealBreakerReason} onChange={(e) => setDealBreakerReason(e.target.value)} />
          <FieldLabel>Key assumptions / gaps</FieldLabel>
          <Textarea value={keyAssumptionsGaps} onChange={(e) => setKeyAssumptionsGaps(e.target.value)} />
          <FieldLabel>Site rep feedback</FieldLabel>
          <Textarea value={siteRepFeedback} onChange={(e) => setSiteRepFeedback(e.target.value)} />
        </Card>

        {error ? <ErrorBanner message={error} /> : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || isCompleted}>{busy ? 'Saving…' : 'Save assessment'}</Button>
          <Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}
