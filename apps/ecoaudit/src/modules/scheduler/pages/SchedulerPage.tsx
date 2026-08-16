'use client';

import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import { DeadlineTable } from '@/modules/scheduler/components/DeadlineTable';
import { DynamicSchedulerBoard } from '@/modules/scheduler/components/DynamicSchedulerBoard';
import { EventFormModal } from '@/modules/scheduler/components/EventFormModal';
import { SchedulerDashboard } from '@/modules/scheduler/components/SchedulerDashboard';
import { SchedulerFinanceWorkspace } from '@/modules/scheduler/components/SchedulerFinanceWorkspace';
import { UserFilter } from '@/modules/scheduler/components/UserFilter';
import type {
  ScheduleEvent,
  SchedulerFinanceTarget,
} from '@/modules/scheduler/types/domain';

export type SchedulerTab = 'overview' | 'calendar' | 'deadlines' | 'finance';

export default function SchedulerPage({
  initialTab = 'calendar',
  initialFinanceTarget,
}: {
  initialTab?: SchedulerTab;
  initialFinanceTarget?: SchedulerFinanceTarget;
}) {
  const { eaUser, ssUser, ihUser } = usePortalAuth();
  const isAdmin = Boolean(
    eaUser?.role === 'admin'
    || ssUser?.role === 'admin'
    || ihUser?.role === 'admin',
  );

  const [tab, setTab] = useState<SchedulerTab>(initialTab);
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [slotDay, setSlotDay] = useState<Date | null>(null);
  const [editing, setEditing] = useState<ScheduleEvent | null>(null);
  const [financeTarget, setFinanceTarget] = useState<SchedulerFinanceTarget | undefined>(initialFinanceTarget);
  const activeTab: SchedulerTab = tab === 'finance' && !isAdmin ? 'calendar' : tab;

  const tabs = useMemo(
    () => [
      { id: 'overview' as const, label: 'Overview' },
      { id: 'calendar' as const, label: 'Calendar' },
      { id: 'deadlines' as const, label: 'Deadlines' },
      ...(isAdmin ? [{ id: 'finance' as const, label: 'Finance' }] : []),
    ],
    [isAdmin],
  );

  function openCreate(day?: Date) {
    setEditing(null);
    setSlotDay(day ?? null);
    setModalOpen(true);
  }

  function openEdit(event: ScheduleEvent) {
    setEditing(event);
    setSlotDay(null);
    setModalOpen(true);
  }

  return (
    <div className={`mx-auto w-full ${activeTab === 'calendar' || activeTab === 'finance' ? 'max-w-[90rem]' : 'max-w-6xl'}`}>
      <PageHeader
        title="Scheduler"
        subtitle={activeTab === 'finance'
          ? 'Admin-only commercial control for every audit, assessment, and installation.'
          : 'Assign audits, solar work, field jobs, and custom tasks — calendar + deadline board.'}
        actions={
          isAdmin ? (
            <Button onClick={() => openCreate()}>+ Schedule job</Button>
          ) : undefined
        }
      />

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="flex max-w-full overflow-x-auto rounded-full bg-[var(--surface2)] p-1" role="tablist" aria-label="Scheduler views">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`scheduler-tab-${t.id}`}
              aria-selected={activeTab === t.id}
              aria-controls={`scheduler-panel-${t.id}`}
              onClick={() => {
                setTab(t.id);
                if (typeof window !== 'undefined') {
                  const params = new URLSearchParams(window.location.search);
                  params.set('tab', t.id);
                  if (t.id !== 'finance') {
                    params.delete('eventId');
                    params.delete('financeId');
                    params.delete('sourceApp');
                    params.delete('sourceId');
                    params.delete('invoiceId');
                  }
                  window.history.replaceState(null, '', `/scheduler?${params.toString()}`);
                }
              }}
              className={`min-h-11 rounded-full px-4 py-2 text-sm font-extrabold transition-colors ${
                activeTab === t.id
                  ? 'bg-[var(--surface)] text-[var(--text)] shadow-sm'
                  : 'text-[var(--text-sub)] hover:text-[var(--text)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {activeTab === 'deadlines' && isAdmin ? (
          <UserFilter
            enabled={isAdmin}
            value={assigneeFilter}
            onChange={setAssigneeFilter}
          />
        ) : null}
      </div>

      {activeTab === 'overview' ? (
        <div id="scheduler-panel-overview" role="tabpanel" aria-labelledby="scheduler-tab-overview">
          <SchedulerDashboard
          onOpenDeadlines={() => setTab('deadlines')}
          onCreate={() => openCreate()}
          />
        </div>
      ) : null}

      {activeTab === 'calendar' ? (
        <div id="scheduler-panel-calendar" role="tabpanel" aria-labelledby="scheduler-tab-calendar">
          <DynamicSchedulerBoard
            isAdmin={isAdmin}
            onSlotCreate={(day) => {
              if (isAdmin) openCreate(day);
            }}
            onEventEdit={openEdit}
          />
        </div>
      ) : null}

      {activeTab === 'deadlines' ? (
        <div id="scheduler-panel-deadlines" role="tabpanel" aria-labelledby="scheduler-tab-deadlines">
          <DeadlineTable
            assigneeFieldUserId={assigneeFilter || undefined}
            onSelect={openEdit}
          />
        </div>
      ) : null}

      {activeTab === 'finance' && isAdmin ? (
        <div id="scheduler-panel-finance" role="tabpanel" aria-labelledby="scheduler-tab-finance">
          <SchedulerFinanceWorkspace initialTarget={financeTarget} />
        </div>
      ) : null}

      <EventFormModal
        key={modalOpen
          ? editing
            ? `edit:${editing.id}`
            : `create:${slotDay?.toISOString() ?? 'now'}`
          : 'closed'}
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
          setSlotDay(null);
        }}
        initialDay={slotDay}
        event={editing}
        isAdmin={isAdmin}
        onOpenFinance={(event) => {
          setFinanceTarget({
            eventId: event.id,
            sourceApp: event.sourceApp === 'custom' ? undefined : event.sourceApp,
            sourceId: event.sourceId ?? undefined,
          });
          setModalOpen(false);
          setEditing(null);
          setSlotDay(null);
          setTab('finance');
        }}
      />
    </div>
  );
}
