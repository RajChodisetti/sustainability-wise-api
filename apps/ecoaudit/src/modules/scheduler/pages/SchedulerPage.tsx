'use client';

import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import { DeadlineTable } from '@/modules/scheduler/components/DeadlineTable';
import { DynamicSchedulerBoard } from '@/modules/scheduler/components/DynamicSchedulerBoard';
import { EventFormModal } from '@/modules/scheduler/components/EventFormModal';
import { SchedulerDashboard } from '@/modules/scheduler/components/SchedulerDashboard';
import { SchedulerFinanceAnalytics } from '@/modules/scheduler/components/SchedulerFinanceAnalytics';
import { SchedulerFinanceWorkspace } from '@/modules/scheduler/components/SchedulerFinanceWorkspace';
import { SchedulerInventoryDashboard } from '@/modules/scheduler/components/SchedulerInventoryDashboard';
import { SchedulerMeterRegister } from '@/modules/scheduler/components/SchedulerMeterRegister';
import { SchedulerRouteWorkspace } from '@/modules/scheduler/components/SchedulerRouteWorkspace';
import { SchedulerUsersWorkspace } from '@/modules/scheduler/components/SchedulerUsersWorkspace';
import { UserFilter } from '@/modules/scheduler/components/UserFilter';
import { schedulerFinanceHref, schedulerTabTransition } from '@/modules/scheduler/lib/finance';
import {
  schedulerTabHref,
  schedulerTabAllowsJobCreation,
  schedulerTabIsAdminOnly,
  schedulerTabShowsUserRatesAction,
  type SchedulerTab,
} from '@/modules/scheduler/lib/navigation';
import {
  schedulerCreatableSourceApps,
  schedulerIsFieldOnly,
} from '@/modules/scheduler/lib/visibility';
import type {
  ScheduleEvent,
  ScheduleSourceApp,
  SchedulerFinanceTarget,
} from '@/modules/scheduler/types/domain';

function isFinanceWorkspaceTab(tab: SchedulerTab): tab is 'financial-summary' | 'bills' | 'invoices' {
  return tab === 'financial-summary' || tab === 'bills' || tab === 'invoices';
}

function isAdminOnlyTab(tab: SchedulerTab): boolean {
  return schedulerTabIsAdminOnly(tab);
}

export default function SchedulerPage({
  initialTab = 'calendar',
  initialFinanceTarget,
  visibleSourceApps,
  selectableSourceApps,
}: {
  initialTab?: SchedulerTab;
  initialFinanceTarget?: SchedulerFinanceTarget;
  visibleSourceApps: ScheduleSourceApp[];
  selectableSourceApps: ScheduleSourceApp[];
}) {
  const { eaUser, ssUser, ihUser } = usePortalAuth();
  const isAdmin = Boolean(
    eaUser?.role === 'admin'
    || ssUser?.role === 'admin'
    || ihUser?.role === 'admin',
  );
  const creatableSourceApps = useMemo(() => schedulerCreatableSourceApps(
    selectableSourceApps,
    [
      ...(eaUser ? ['ecoaudit' as const] : []),
      ...(ssUser ? ['solarsense' as const] : []),
      ...(ihUser ? ['installhub' as const] : []),
    ],
  ), [eaUser, ihUser, selectableSourceApps, ssUser]);

  const [tab, setTab] = useState<SchedulerTab>(initialTab);
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [slotDay, setSlotDay] = useState<Date | null>(null);
  const [editing, setEditing] = useState<ScheduleEvent | null>(null);
  const [financeTarget, setFinanceTarget] = useState<SchedulerFinanceTarget | undefined>(initialFinanceTarget);
  const activeTab: SchedulerTab = isAdminOnlyTab(tab) && !isAdmin ? 'calendar' : tab;
  const fieldOnly = schedulerIsFieldOnly(selectableSourceApps);

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
    const transition = nextTab === 'users'
      ? { href: schedulerTabHref(nextTab), financeTarget: undefined }
      : targetOverride && isFinanceWorkspaceTab(nextTab)
        ? {
            href: schedulerFinanceHref({ view: nextTab, ...targetOverride }),
            financeTarget: targetOverride,
          }
        : schedulerTabTransition(window.location.search, nextTab);
    setFinanceTarget(transition.financeTarget);
    window.history.replaceState(null, '', transition.href);
  }

  return (
    <div className={`mx-auto w-full ${activeTab === 'calendar' || activeTab === 'my-route' || activeTab === 'users' || activeTab === 'finance-analytics' || isFinanceWorkspaceTab(activeTab) ? 'max-w-[96rem]' : 'max-w-6xl'}`}>
      <PageHeader
        title="Scheduler"
        subtitle={schedulerSubtitle(activeTab, fieldOnly)}
        actions={isAdmin ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {schedulerTabAllowsJobCreation(activeTab) ? (
              <Button onClick={() => openCreate()}>
                <Icon name="plus" size={18} />
                Schedule job
              </Button>
            ) : null}
            {schedulerTabShowsUserRatesAction(activeTab) ? (
              <Button variant="secondary" onClick={() => activateTab('users')}>
                <Icon name="users" size={18} />
                User rates
              </Button>
            ) : null}
          </div>
        ) : undefined}
      />

      {activeTab === 'deadlines' && isAdmin ? (
        <div className="mb-5 flex justify-end">
          <UserFilter
            enabled={isAdmin}
            value={assigneeFilter}
            onChange={setAssigneeFilter}
          />
        </div>
      ) : null}

      {activeTab === 'overview' ? (
        <div id="scheduler-panel-overview" role="region" aria-label="Planning overview" tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30">
          <SchedulerDashboard
            canCreate={isAdmin}
            visibleSourceApps={visibleSourceApps}
            onOpenDeadlines={() => activateTab('deadlines')}
            onCreate={() => openCreate()}
          />
        </div>
      ) : null}

      {activeTab === 'calendar' ? (
        <div id="scheduler-panel-calendar" role="region" aria-label="Planning calendar" tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30">
          <DynamicSchedulerBoard
            isAdmin={isAdmin}
            visibleSourceApps={visibleSourceApps}
            selectableSourceApps={selectableSourceApps}
            onSlotCreate={(day) => {
              if (isAdmin) openCreate(day);
            }}
            onEventEdit={openEdit}
          />
        </div>
      ) : null}

      {activeTab === 'my-route' ? (
        <div id="scheduler-panel-my-route" role="region" aria-label="Planning route" tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30">
          <SchedulerRouteWorkspace isAdmin={isAdmin} />
        </div>
      ) : null}

      {activeTab === 'deadlines' ? (
        <div id="scheduler-panel-deadlines" role="region" aria-label="Planning deadlines" tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30">
          <DeadlineTable
            assigneeFieldUserId={assigneeFilter || undefined}
            visibleSourceApps={visibleSourceApps}
            onSelect={openEdit}
          />
        </div>
      ) : null}

      {activeTab === 'inventory' && isAdmin ? (
        <div id="scheduler-panel-inventory" role="region" aria-label="Inventory dashboard" tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30">
          <SchedulerInventoryDashboard />
        </div>
      ) : null}

      {activeTab === 'meter-register' && isAdmin ? (
        <div id="scheduler-panel-meter-register" role="region" aria-label="Meter Register" tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30">
          <SchedulerMeterRegister />
        </div>
      ) : null}

      {activeTab === 'finance-analytics' && isAdmin ? (
        <div id="scheduler-panel-finance-analytics" role="region" aria-label="Finance analytics" tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30">
          <SchedulerFinanceAnalytics />
        </div>
      ) : null}

      {activeTab === 'users' && isAdmin ? (
        <div id="scheduler-panel-users" role="region" aria-label="Scheduler users" tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30">
          <SchedulerUsersWorkspace />
        </div>
      ) : null}

      {isFinanceWorkspaceTab(activeTab) && isAdmin ? (
        <div id={`scheduler-panel-${activeTab}`} role="region" aria-label="Finance workspace" tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30">
          <SchedulerFinanceWorkspace
            view={activeTab}
            initialTarget={financeTarget}
            visibleSourceApps={visibleSourceApps}
            selectableSourceApps={selectableSourceApps}
            onActivateView={(nextView) => activateTab(nextView)}
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
        selectableSourceApps={selectableSourceApps}
        creatableSourceApps={creatableSourceApps}
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

function schedulerSubtitle(tab: SchedulerTab, fieldOnly: boolean): string {
  if (tab === 'my-route') {
    return 'Order a technician’s Australian jobs from a live or selected starting point, with travel-time estimates.';
  }
  if (tab === 'inventory') {
    return 'See company stock and the meters currently held by each Field user.';
  }
  if (tab === 'meter-register') {
    return 'Add and search non-installed company stock, and see which Field user currently holds each meter.';
  }
  if (tab === 'finance-analytics') {
    return 'Analyse completed-work, invoice, payment, void, GST, and refund progress for any reporting window.';
  }
  if (tab === 'users') {
    return 'Manage canonical default billing rates and review each user’s current-week Scheduler workload.';
  }
  if (tab === 'financial-summary') {
    return fieldOnly
      ? 'Review Field App portfolio position, recorded hours, rates, and job profitability.'
      : 'Review portfolio position, recorded hours, rates, and job profitability across all products.';
  }
  if (tab === 'bills') {
    return 'Add, upload, and reconcile job costs and supplier evidence in one ledger.';
  }
  if (tab === 'invoices') {
    return 'Create single or consolidated invoices, then issue, export, and track payment.';
  }
  if (tab === 'overview') {
    return fieldOnly
      ? 'See today’s Field App workload, upcoming deadlines, and scheduled work at a glance.'
      : 'See today’s workload, upcoming deadlines, and scheduled work at a glance.';
  }
  if (tab === 'deadlines') {
    return fieldOnly
      ? 'Review Field App due dates in urgency order and open a job for full details.'
      : 'Review every due date in urgency order and open a job for full details.';
  }
  return fieldOnly
    ? 'Plan Field App jobs and custom tasks in one weekly workspace.'
    : 'Plan audits, solar work, field jobs, and custom tasks in one weekly workspace.';
}
