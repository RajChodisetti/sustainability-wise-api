'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { createSite, getSite, updateSite } from '@solar/api/sites';
import { Button } from '@solar/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@solar/components/ui/Card';
import { FieldLabel, Input, Textarea } from '@solar/components/ui/FormFields';
import { cloudConnectionErrorMessage } from '@solar/api/client';


function asId(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}


export default function SiteFormPage() {
  const params = useParams();
  const siteId = asId(params.siteId);
  const isEdit = Boolean(siteId);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siteName, setSiteName] = useState('');
  const [location, setLocation] = useState('');
  const [dateOfAssessment, setDateOfAssessment] = useState('');
  const [documentClassification, setDocumentClassification] = useState('');
  const [electricalInfrastructureSummary, setElectricalInfrastructureSummary] = useState('');
  const [knownConstraints, setKnownConstraints] = useState('');
  const [loadProfileMeteringSummary, setLoadProfileMeteringSummary] = useState('');
  const [ppaAssetDemarcation, setPpaAssetDemarcation] = useState('');
  const [appendixNotes, setAppendixNotes] = useState('');

  const siteQuery = useQuery({
    queryKey: ['site', siteId],
    queryFn: () => getSite(siteId!),
    enabled: isEdit,
  });

  useEffect(() => {
    const site = siteQuery.data;
    if (!site) return;
    setSiteName(site.siteName);
    setLocation(site.location ?? '');
    setDateOfAssessment(site.dateOfAssessment ?? '');
    setDocumentClassification(site.documentClassification ?? '');
    setElectricalInfrastructureSummary(site.electricalInfrastructureSummary ?? '');
    setKnownConstraints(site.knownConstraints ?? '');
    setLoadProfileMeteringSummary(site.loadProfileMeteringSummary ?? '');
    setPpaAssetDemarcation(site.ppaAssetDemarcation ?? '');
    setAppendixNotes(site.appendixNotes ?? '');
  }, [siteQuery.data]);

  if (isEdit && siteQuery.isLoading) return <Spinner />;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!siteName.trim()) {
      setError('Site name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      siteName: siteName.trim(),
      location: location || null,
      dateOfAssessment: dateOfAssessment || null,
      documentClassification: documentClassification || null,
      electricalInfrastructureSummary: electricalInfrastructureSummary || null,
      knownConstraints: knownConstraints || null,
      loadProfileMeteringSummary: loadProfileMeteringSummary || null,
      ppaAssetDemarcation: ppaAssetDemarcation || null,
      appendixNotes: appendixNotes || null,
    };
    try {
      const saved = isEdit ? await updateSite(siteId!, payload) : await createSite(payload);
      router.push(`/solar/sites/${saved.id}`);
    } catch (err) {
      setError(cloudConnectionErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title={isEdit ? 'Edit site' : 'New site'} />
      <Card className="max-w-3xl">
        <form onSubmit={handleSave}>
          <FieldLabel>Site name / ID *</FieldLabel>
          <Input value={siteName} onChange={(e) => setSiteName(e.target.value)} required />
          <FieldLabel>Location</FieldLabel>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} />
          <FieldLabel>Date of assessment</FieldLabel>
          <Input value={dateOfAssessment} onChange={(e) => setDateOfAssessment(e.target.value)} placeholder="YYYY-MM-DD" />
          <FieldLabel>Document classification</FieldLabel>
          <Input value={documentClassification} onChange={(e) => setDocumentClassification(e.target.value)} />
          <FieldLabel>Electrical infrastructure summary</FieldLabel>
          <Textarea value={electricalInfrastructureSummary} onChange={(e) => setElectricalInfrastructureSummary(e.target.value)} />
          <FieldLabel>Known constraints</FieldLabel>
          <Textarea value={knownConstraints} onChange={(e) => setKnownConstraints(e.target.value)} />
          <FieldLabel>Load profile / metering summary</FieldLabel>
          <Textarea value={loadProfileMeteringSummary} onChange={(e) => setLoadProfileMeteringSummary(e.target.value)} />
          <FieldLabel>PPA asset demarcation</FieldLabel>
          <Textarea value={ppaAssetDemarcation} onChange={(e) => setPpaAssetDemarcation(e.target.value)} />
          <FieldLabel>Appendix notes</FieldLabel>
          <Textarea value={appendixNotes} onChange={(e) => setAppendixNotes(e.target.value)} />
          {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}
          <div className="mt-6 flex gap-2">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save site'}</Button>
            <Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
