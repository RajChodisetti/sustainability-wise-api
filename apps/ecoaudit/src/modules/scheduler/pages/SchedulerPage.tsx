'use client';

import { useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import { DeadlineTable } from '@/modules/scheduler/components/DeadlineTable';
import { DynamicSchedulerBoard } from '@/modules/scheduler/components/DynamicSchedulerBoard';
import { EventFormModal } from '@/modules/scheduler/components/EventFormModal';
import { SchedulerDashboard } from '@/modules/scheduler/components/SchedulerDashboard';
import { SchedulerFinanceAnalytics } from '@/modules/scheduler/components/SchedulerFinanceAnalytics';
import { SchedulerFinanceWorkspace } from '@/modules/scheduler/components/SchedulerFinanceWorkspace';
import { SchedulerLeaveWorkspace } from '@/modules/scheduler/components/SchedulerLeaveWorkspace';
import { SchedulerPeopleLeaderboard } from '@/modules/scheduler/components/SchedulerPeopleLeaderboard';
import { SchedulerRouteWorkspace } from '@/modules/scheduler/components/SchedulerRouteWorkspace';
import { SchedulerWorkforceProfiles } from '@/modules/scheduler/components/SchedulerWorkforceProfiles';
import { UserFilter } from '@/modules/scheduler/components/UserFilter';
import { schedulerFinanceHref, schedulerTabTransition } from '@/modules/scheduler/lib/finance';
import {
  schedulerCreatableSourceApps,
  schedulerIsFieldOnly,
} from '@/modules/scheduler/lib/visibility';
import type {
  ScheduleEvent,
  ScheduleSourceApp,
  SchedulerFinanceTarget,
} from '@/modules/scheduler/types/domain';

export type SchedulerTab =
  | 'overview'
  | 'calendar'
  | 'my-route'
  | 'deadlines'
  | 'team-performance'
  | 'leave'
  | 'finance-analytics'
  | 'financial-summary'
  | 'bills'
  | 'invoices';

type SchedulerTabItem = {
  id: SchedulerTab;
  label: string;
  icon: IconName;
};

const PLANNING_TABS: SchedulerTabItem[] = [
  { id: 'overview', label: 'Overview', icon: 'gauge' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar' },
  { id: 'my-route', label: 'My route', icon: 'map-pin' },
  { id: 'deadlines', label: 'Deadlines', icon: 'clipboard' },
];

const PEOPLE_TABS: SchedulerTabItem[] = [
  { id: 'team-performance', label: 'Team performance', icon: 'users' },
  { id: 'leave', label: 'Leave', icon: 'calendar' },
];

const FINANCE_TABS: SchedulerTabItem[] = [
  { id: 'finance-analytics', label: 'Analytics', icon: 'activity' },
  { id: 'financial-summary', label: 'Summary', icon: 'activity' },
  { id: 'bills', label: 'Bills & expenses', icon: 'file-text' },
  { id: 'invoices', label: 'Invoices', icon: 'file-text' },
];

function isFinanceWorkspaceTab(tab: SchedulerTab): tab is 'financial-summary' | 'bills' | 'invoices' {
  return tab === 'financial-summary' || tab === 'bills' || tab === 'invoices';
}

function isAdminOnlyTab(tab: SchedulerTab): boolean {
  return tab === 'team-performance'
    || tab === 'finance-analytics'
    || isFinanceWorkspaceTab(tab);
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
  const tabRefs = useRef<Partial<Record<SchedulerTab, HTMLButtonElement | null>>>({});
  const activeTab: SchedulerTab = isAdminOnlyTab(tab) && !isAdmin ? 'calendar' : tab;
  const fieldOnly = schedulerIsFieldOnly(selectableSourceApps);

  const tabs = useMemo(
    () => [
      ...PLANNING_TABS,
      ...(isAdmin ? PEOPLE_TABS : PEOPLE_TABS.filter((item) => item.id === 'leave')),
      ...(isAdmin ? FINANCE_TABS : []),
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
    const transition = targetOverride && isFinanceWorkspaceTab(nextTab)
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
    <div className={`mx-auto w-full ${activeTab === 'calendar' || activeTab === 'my-route' || activeTab === 'team-performance' || activeTab === 'finance-analytics' || isFinanceWorkspaceTab(activeTab) ? 'max-w-[96rem]' : 'max-w-6xl'}`}>
      <PageHeader
        title="Scheduler"
        subtitle={schedulerSubtitle(activeTab, fieldOnly)}
        actions={
          isAdmin ? (
            <Button onClick={() => openCreate()}>
              <Icon name="plus" size={18} />
              Schedule job
            </Button>
          ) : undefined
        }
      />

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div
          className="subtle-scrollbar max-w-full overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-2 shadow-[var(--shadow-xs)]"
          role="tablist"
          aria-label="Scheduler views"
          aria-orientation="horizontal"
        >
          <div className="flex min-w-max items-center gap-2">
            {[
              { label: 'Planning', items: PLANNING_TABS },
              {
                label: 'People',
                items: isAdmin
                  ? PEOPLE_TABS
                  : PEOPLE_TABS.filter((item) => item.id === 'leave'),
              },
              ...(isAdmin ? [{ label: 'Finance', items: FINANCE_TABS }] : []),
            ].map((group, groupIndex) => (
              <div
                key={group.label}
                role="presentation"
                className={`flex items-center gap-1 ${groupIndex > 0 ? 'border-l border-[var(--border)] pl-2' : ''}`}
              >
                <span className="px-2 text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted)]">
                  {group.label}
                </span>
                {group.items.map((item) => {
                  const index = tabs.findIndex((candidate) => candidate.id === item.id);
                  return (
                    <button
                      key={item.id}
                      ref={(node) => { tabRefs.current[item.id] = node; }}
                      type="button"
                      role="tab"
                      id={`scheduler-tab-${item.id}`}
                      aria-selected={activeTab === item.id}
                      aria-controls={`scheduler-panel-${item.id}`}
                      tabIndex={activeTab === item.id ? 0 : -1}
                      onClick={() => activateTab(item.id)}
                      onKeyDown={(event) => handleTabKeyDown(event, index)}
                      className={`inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-extrabold transition-colors ${
                        activeTab === item.id
                          ? 'bg-[var(--primary-soft)] text-[var(--primary)] shadow-[var(--shadow-xs)]'
                          : 'text-[var(--text-sub)] hover:bg-[var(--surface2)] hover:text-[var(--text)]'
                      }`}
                    >
                      <Icon name={item.icon} size={16} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
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
            canCreate={isAdmin}
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
            selectableSourceApps={selectableSourceApps}
            onSlotCreate={(day) => {
              if (isAdmin) openCreate(day);
            }}
            onEventEdit={openEdit}
          />
        </div>
      ) : null}

      {activeTab === 'my-route' ? (
        <div id="scheduler-panel-my-route" role="tabpanel" aria-labelledby="scheduler-tab-my-route" tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30">
          <SchedulerRouteWorkspace />
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

      {activeTab === 'team-performance' && isAdmin ? (
        <div id="scheduler-panel-team-performance" role="tabpanel" aria-labelledby="scheduler-tab-team-performance" tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30">
          <div className="space-y-5">
            <SchedulerPeopleLeaderboard />
            <SchedulerWorkforceProfiles />
          </div>
        </div>
      ) : null}

      {activeTab === 'leave' ? (
        <div id="scheduler-panel-leave" role="tabpanel" aria-labelledby="scheduler-tab-leave" tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30">
          <SchedulerLeaveWorkspace isAdmin={isAdmin} />
        </div>
      ) : null}

      {activeTab === 'finance-analytics' && isAdmin ? (
        <div id="scheduler-panel-finance-analytics" role="tabpanel" aria-labelledby="scheduler-tab-finance-analytics" tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30">
          <SchedulerFinanceAnalytics />
        </div>
      ) : null}

      {isFinanceWorkspaceTab(activeTab) && isAdmin ? (
        <div id={`scheduler-panel-${activeTab}`} role="tabpanel" aria-labelledby={`scheduler-tab-${activeTab}`} tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/30">
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
    return 'Order assigned Australian jobs from your current location and open the suggested route in Google Maps.';
  }
  if (tab === 'team-performance') {
    return 'Compare Working hours on site, completed jobs, backlog, pipeline, leave-adjusted working days, and attributed revenue.';
  }
  if (tab === 'leave') {
    return 'Apply for leave, review approval status, and keep scheduled work clear of approved dates.';
  }
  if (tab === 'finance-analytics') {
    return 'Analyse completed-work, invoice, payment, void, GST, and refund progress for any reporting window.';
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
