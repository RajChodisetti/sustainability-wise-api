'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  cancelScheduleEvent,
  createScheduleEvent,
  fetchPortalAssignees,
  fetchScheduleEvents,
  fetchScheduleSummary,
  fetchUnscheduledJobs,
  searchJobOptions,
  updateScheduleEvent,
} from '@/modules/scheduler/api/client';
import type {
  CreateScheduleEventInput,
  ScheduleSourceApp,
  UpdateScheduleEventInput,
} from '@/modules/scheduler/types/domain';

export const schedulerKeys = {
  all: ['portal', 'scheduler'] as const,
  summary: () => [...schedulerKeys.all, 'summary'] as const,
  events: (filters: Record<string, string | undefined>) =>
    [...schedulerKeys.all, 'events', filters] as const,
  assignees: () => [...schedulerKeys.all, 'assignees'] as const,
  jobOptions: (q: string, app?: string) =>
    [...schedulerKeys.all, 'job-options', q, app ?? ''] as const,
  unscheduled: (q: string, app?: string) =>
    [...schedulerKeys.all, 'unscheduled', q, app ?? ''] as const,
};

export function useScheduleSummary() {
  return useQuery({
    queryKey: schedulerKeys.summary(),
    queryFn: fetchScheduleSummary,
  });
}

export function useScheduleEvents(filters: {
  from?: string;
  to?: string;
  assigneeFieldUserId?: string;
  sourceApp?: ScheduleSourceApp;
}) {
  return useQuery({
    queryKey: schedulerKeys.events({
      from: filters.from,
      to: filters.to,
      assignee: filters.assigneeFieldUserId,
      app: filters.sourceApp,
    }),
    queryFn: () => fetchScheduleEvents(filters),
  });
}

export function usePortalAssignees(enabled = true) {
  return useQuery({
    queryKey: schedulerKeys.assignees(),
    queryFn: fetchPortalAssignees,
    enabled,
    staleTime: 60_000,
  });
}

export function useJobOptions(q: string, sourceApp?: ScheduleSourceApp, enabled = true) {
  return useQuery({
    queryKey: schedulerKeys.jobOptions(q, sourceApp),
    queryFn: () => searchJobOptions(q, sourceApp),
    enabled: enabled && q.trim().length >= 0,
    staleTime: 15_000,
  });
}

export function useUnscheduledJobs(
  filters: { q?: string; sourceApp?: ScheduleSourceApp } = {},
  enabled = true,
) {
  const q = filters.q ?? '';
  const app = filters.sourceApp;
  return useQuery({
    queryKey: schedulerKeys.unscheduled(q, app),
    queryFn: () => fetchUnscheduledJobs({ q, sourceApp: app, limit: 80 }),
    enabled,
    staleTime: 15_000,
  });
}

export function useCreateScheduleEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateScheduleEventInput) => createScheduleEvent(input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: schedulerKeys.all });
    },
  });
}

export function useUpdateScheduleEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateScheduleEventInput }) =>
      updateScheduleEvent(id, input),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: schedulerKeys.all });
    },
  });
}

export function useCancelScheduleEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelScheduleEvent(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: schedulerKeys.all });
    },
  });
}
