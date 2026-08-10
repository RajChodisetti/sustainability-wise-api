import { request } from '@/api/client';
import type {
  CreateScheduleEventInput,
  JobOption,
  PortalDirectoryUser,
  ScheduleEvent,
  ScheduleSummary,
  ScheduleSourceApp,
  UpdateScheduleEventInput,
} from '@/modules/scheduler/types/domain';

type PortalUsersResponse = {
  data: Array<{
    key: string;
    fullName: string | null;
    displayEmail: string;
    memberships: Array<{
      app: string;
      userId: string;
      role: string;
      isActive: boolean;
    }>;
  }>;
};

export async function fetchScheduleSummary(): Promise<ScheduleSummary> {
  return request<ScheduleSummary>('GET', '/v1/portal/scheduler/summary');
}

export async function fetchScheduleEvents(params: {
  from?: string;
  to?: string;
  assigneeFieldUserId?: string;
  sourceApp?: ScheduleSourceApp;
  status?: string;
  includeCancelled?: boolean;
}): Promise<ScheduleEvent[]> {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.assigneeFieldUserId) qs.set('assigneeFieldUserId', params.assigneeFieldUserId);
  if (params.sourceApp) qs.set('sourceApp', params.sourceApp);
  if (params.status) qs.set('status', params.status);
  if (params.includeCancelled) qs.set('includeCancelled', 'true');
  const suffix = qs.toString() ? `?${qs}` : '';
  const res = await request<{ events: ScheduleEvent[] }>('GET', `/v1/portal/scheduler/events${suffix}`);
  return res.events ?? [];
}

export async function createScheduleEvent(input: CreateScheduleEventInput): Promise<ScheduleEvent> {
  return request<ScheduleEvent>('POST', '/v1/portal/scheduler/events', input);
}

export async function updateScheduleEvent(
  id: string,
  input: UpdateScheduleEventInput,
): Promise<ScheduleEvent> {
  return request<ScheduleEvent>('PATCH', `/v1/portal/scheduler/events/${id}`, input);
}

export async function cancelScheduleEvent(id: string): Promise<ScheduleEvent> {
  return request<ScheduleEvent>('DELETE', `/v1/portal/scheduler/events/${id}`);
}

export async function searchJobOptions(q: string, sourceApp?: ScheduleSourceApp): Promise<JobOption[]> {
  const qs = new URLSearchParams();
  if (q) qs.set('q', q);
  if (sourceApp && sourceApp !== 'custom') qs.set('sourceApp', sourceApp);
  const res = await request<{ options: JobOption[] }>(
    'GET',
    `/v1/portal/scheduler/job-options?${qs}`,
  );
  return res.options ?? [];
}

export async function fetchPortalAssignees(): Promise<PortalDirectoryUser[]> {
  const res = await request<PortalUsersResponse>('GET', '/v1/portal/users');
  const out: PortalDirectoryUser[] = [];
  for (const entry of res.data ?? []) {
    const fieldMembership = entry.memberships.find((m) => m.app === 'installhub' && m.isActive)
      ?? entry.memberships.find((m) => m.isActive);
    if (!fieldMembership) continue;
    out.push({
      key: entry.key,
      fieldUserId: fieldMembership.userId,
      label: entry.fullName?.trim() || entry.displayEmail,
      email: entry.displayEmail,
      role: fieldMembership.role,
    });
  }
  // Dedupe by field user id
  const seen = new Set<string>();
  return out.filter((u) => {
    if (seen.has(u.fieldUserId)) return false;
    seen.add(u.fieldUserId);
    return true;
  });
}
