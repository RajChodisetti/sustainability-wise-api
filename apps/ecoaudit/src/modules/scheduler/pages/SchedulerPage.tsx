'use client';

import { useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import { DeadlineTable } from '@/modules/scheduler/components/DeadlineTable';
import { DynamicSchedulerBoard } from '@/modules/scheduler/components/DynamicSchedulerBoard';
import { EventFormModal } from '@/modules/scheduler/components/EventFormModal';
import { SchedulerDashboard } from '@/modules/scheduler/components/SchedulerDashboard';
import { SchedulerFinanceWorkspace } from '@/modules/scheduler/components/SchedulerFinanceWorkspace';
import { UserFilter } from '@/modules/scheduler/components/UserFilter';
import { schedulerFinanceHref, schedulerTabTransition } from '@/modules/scheduler/lib/finance';
import { schedulerIsFieldOnly } from '@/modules/scheduler/lib/visibility';
import type {
  ScheduleEvent,
  ScheduleSourceApp,
  SchedulerFinanceTarget,
} from '@/modules/scheduler/types/domain';

export type SchedulerTab =
  | 'overview'
  | 'calendar'
  | 'deadlines'
  | 'financial-summary'
  | 'bills'
  | 'invoices';

function isFinanceTab(tab: SchedulerTab): tab is 'financial-summary' | 'bills' | 'invoices' {
  return tab === 'financial-summary' || tab === 'bills' || tab === 'invoices';
}

export default function SchedulerPage({
  initialTab = 'calendar',
  initialFinanceTarget,
  visibleSourceApps,
}: {
  initialTab?: SchedulerTab;
  initialFinanceTarget?: SchedulerFinanceTarget;
  visibleSourceApps: ScheduleSourceApp[];
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
  const tabRefs = useRef<Partial<Record<SchedulerTab, HTMLButtonElement | null>>>({});
  const activeTab: SchedulerTab = isFinanceTab(tab) && !isAdmin ? 'calendar' : tab;
  const fieldOnly = schedulerIsFieldOnly(visibleSourceApps);

  const tabs = useMemo(
    () => [
      { id: 'overview' as const, label: 'Overview' },
      { id: 'calendar' as const, label: 'Calendar' },
      { id: 'deadlines' as const, label: 'Deadlines' },
      ...(isAdmin ? [
        { id: 'financial-summary' as const, label: 'Financial Summary' },
        { id: 'bills' as const, label: 'Bills & Expenses' },
        { id: 'invoices' as const, label: 'Invoices' },
      ] : []),
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

  function activateTab(nextTab: SchedulerTab, targetOverride?: SchedulerFinanceTarget) {
    setTab(nextTab);
    if (typeof window === 'undefined') return;
    const transition = targetOverride && isFinanceTab(nextTab)
      ? {
          href: schedulerFinanceHref({ view: nextTab, ...targetOverride }),
          financeTarget: targetOverride,
        }
      : schedulerTabTransition(window.location.search, nextTab);
    setFinanceTarget(transition.financeTarget);
    window.history.replaceState(null, '', transition.href);
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex == null) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex]?.id;
    if (!nextTab) return;
    activateTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  }

  return (
    <div className={`mx-auto w-full ${activeTab === 'calendar' || isFinanceTab(activeTab) ? 'max-w-[90rem]' : 'max-w-6xl'}`}>
      <PageHeader
        title="Scheduler"
        subtitle={isFinanceTab(activeTab)
          ? activeTab === 'financial-summary'
            ? fieldOnly
              ? 'Field App portfolio position, recorded hours, rates, and job profitability.'
              : 'Portfolio position, recorded hours, rates, and job profitability across all three apps.'
            : activeTab === 'bills'
              ? 'Add, upload, and reconcile job costs and supplier evidence in one ledger.'
              : 'Create single or consolidated invoices, then issue, export, and track payment.'
          : fieldOnly
            ? 'Assign Field App jobs and custom tasks — calendar + deadline board.'
            : 'Assign audits, solar work, field jobs, and custom tasks — calendar + deadline board.'}
        actions={
          isAdmin ? (
            <Button onClick={() => openCreate()}>+ Schedule job</Button>
          ) : undefined
        }
      />

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="flex max-w-full overflow-x-auto rounded-full bg-[var(--surface2)] p-1" role="tablist" aria-label="Scheduler views" aria-orientation="horizontal">
          {tabs.map((t, index) => (
            <button
              key={t.id}
              ref={(node) => { tabRefs.current[t.id] = node; }}
              type="button"
              role="tab"
              id={`scheduler-tab-${t.id}`}
              aria-selected={activeTab === t.id}
              aria-controls={`scheduler-panel-${t.id}`}
              tabIndex={activeTab === t.id ? 0 : -1}
              onClick={() => activateTab(t.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
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
        <div id="scheduler-panel-overview" role="tabpanel" aria-labelledby="scheduler-tab-overview" tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30">
          <SchedulerDashboard
            visibleSourceApps={visibleSourceApps}
            onOpenDeadlines={() => activateTab('deadlines')}
            onCreate={() => openCreate()}
          />
        </div>
      ) : null}

      {activeTab === 'calendar' ? (
        <div id="scheduler-panel-calendar" role="tabpanel" aria-labelledby="scheduler-tab-calendar" tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30">
          <DynamicSchedulerBoard
            isAdmin={isAdmin}
            visibleSourceApps={visibleSourceApps}
            onSlotCreate={(day) => {
              if (isAdmin) openCreate(day);
            }}
            onEventEdit={openEdit}
          />
        </div>
      ) : null}

      {activeTab === 'deadlines' ? (
        <div id="scheduler-panel-deadlines" role="tabpanel" aria-labelledby="scheduler-tab-deadlines" tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30">
          <DeadlineTable
            assigneeFieldUserId={assigneeFilter || undefined}
            visibleSourceApps={visibleSourceApps}
            onSelect={openEdit}
          />
        </div>
      ) : null}

      {isFinanceTab(activeTab) && isAdmin ? (
        <div id={`scheduler-panel-${activeTab}`} role="tabpanel" aria-labelledby={`scheduler-tab-${activeTab}`} tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30">
          <SchedulerFinanceWorkspace
            view={activeTab}
            initialTarget={financeTarget}
            visibleSourceApps={visibleSourceApps}
          />
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
        visibleSourceApps={visibleSourceApps}
        onOpenFinance={(event) => {
          const target: SchedulerFinanceTarget = {
            eventId: event.id,
            sourceApp: event.sourceApp === 'custom' ? undefined : event.sourceApp,
            sourceId: event.sourceId ?? undefined,
          };
          setModalOpen(false);
          setEditing(null);
          setSlotDay(null);
          activateTab('financial-summary', target);
        }}
      />
    </div>
  );
}
