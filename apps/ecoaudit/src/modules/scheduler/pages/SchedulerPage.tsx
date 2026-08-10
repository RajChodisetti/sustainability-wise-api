'use client';

import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import { DeadlineTable } from '@/modules/scheduler/components/DeadlineTable';
import { EventFormModal } from '@/modules/scheduler/components/EventFormModal';
import { SchedulerCalendar } from '@/modules/scheduler/components/SchedulerCalendar';
import { SchedulerDashboard } from '@/modules/scheduler/components/SchedulerDashboard';
import { UserFilter } from '@/modules/scheduler/components/UserFilter';
import type { ScheduleEvent } from '@/modules/scheduler/types/domain';

type Tab = 'overview' | 'calendar' | 'deadlines';

export default function SchedulerPage() {
  const { eaUser, ssUser, ihUser } = usePortalAuth();
  const isAdmin = Boolean(
    eaUser?.role === 'admin'
    || ssUser?.role === 'admin'
    || ihUser?.role === 'admin',
  );

  const [tab, setTab] = useState<Tab>('overview');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [slotDay, setSlotDay] = useState<Date | null>(null);
  const [editing, setEditing] = useState<ScheduleEvent | null>(null);

  const tabs = useMemo(
    () => [
      { id: 'overview' as const, label: 'Overview' },
      { id: 'calendar' as const, label: 'Calendar' },
      { id: 'deadlines' as const, label: 'Deadlines' },
    ],
    [],
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
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Scheduler"
        subtitle="Assign audits, solar work, field jobs, and custom tasks — calendar + deadline board."
        actions={
          isAdmin ? (
            <Button onClick={() => openCreate()}>+ Schedule job</Button>
          ) : undefined
        }
      />

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="flex rounded-full bg-[var(--surface2)] p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-full px-4 py-2 text-sm font-extrabold transition-colors ${
                tab === t.id
                  ? 'bg-[var(--surface)] text-[var(--text)] shadow-sm'
                  : 'text-[var(--text-sub)] hover:text-[var(--text)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {(tab === 'calendar' || tab === 'deadlines') && isAdmin ? (
          <UserFilter
            enabled={isAdmin}
            value={assigneeFilter}
            onChange={setAssigneeFilter}
          />
        ) : null}
      </div>

      {tab === 'overview' ? (
        <SchedulerDashboard
          onOpenDeadlines={() => setTab('deadlines')}
          onCreate={() => openCreate()}
        />
      ) : null}

      {tab === 'calendar' ? (
        <SchedulerCalendar
          assigneeFieldUserId={assigneeFilter || undefined}
          onSlotClick={(day) => {
            if (isAdmin) openCreate(day);
          }}
          onEventClick={openEdit}
        />
      ) : null}

      {tab === 'deadlines' ? (
        <DeadlineTable
          assigneeFieldUserId={assigneeFilter || undefined}
          onSelect={openEdit}
        />
      ) : null}

      <EventFormModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
          setSlotDay(null);
        }}
        initialDay={slotDay}
        event={editing}
        isAdmin={isAdmin}
      />
    </div>
  );
}
