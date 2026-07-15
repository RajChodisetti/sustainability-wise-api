'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAllAssessments, useSites } from '@solar/hooks/useSites';
import { Button } from '@solar/components/ui/Button';
import { DealBreakerFlag, RAGBadge, StatusBadge, ViabilityBadge } from '@solar/components/ui/Badges';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@solar/components/ui/Card';
import { Input } from '@solar/components/ui/FormFields';
import { cloudConnectionErrorMessage } from '@solar/api/client';

export default function AssessmentsPage() {
  const sitesQuery = useSites();
  const assessmentsQuery = useAllAssessments();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const list = assessmentsQuery.data ?? [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(
      (a) =>
        a.buildingIdName.toLowerCase().includes(q) ||
        a.siteName.toLowerCase().includes(q) ||
        (a.viabilityStatus ?? '').toLowerCase().includes(q),
    );
  }, [assessmentsQuery.data, search]);

  if (sitesQuery.isLoading || assessmentsQuery.isLoading) return <Spinner />;
  const error = sitesQuery.error || assessmentsQuery.error;
  if (error) return <ErrorBanner message={cloudConnectionErrorMessage(error)} />;

  return (
    <div>
      <PageHeader title="Assessments" subtitle="All building assessments across sites" />
      <div className="mb-4">
        <Input placeholder="Search assessments…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
      </div>
      {filtered.length === 0 ? (
        <EmptyState title="No assessments" description="Add a building assessment from a site detail page." />
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => (
            <Card key={a.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-[var(--text)]">{a.buildingIdName}</p>
                  <p className="text-sm text-[var(--text-sub)]">{a.siteName}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <StatusBadge status={a.status} />
                    <ViabilityBadge value={a.viabilityStatus} />
                    <RAGBadge value={a.ragPriority} />
                    <DealBreakerFlag active={a.heritageDealBreaker} label="Heritage DB" />
                    <DealBreakerFlag active={a.structuralRiskFlag} label="Structural risk" />
                  </div>
                </div>
                <div className="flex gap-2">
                  {a.siteId ? (
                    <>
                      <Link href={`/solar/sites/${a.siteId}/assessments/${a.id}`}><Button variant="secondary">View</Button></Link>
                      <Link href={`/solar/sites/${a.siteId}/assessments/${a.id}/edit`}><Button>Edit</Button></Link>
                    </>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
