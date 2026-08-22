export type SchedulerLeaveType = 'annual' | 'personal' | 'unpaid' | 'other';
export type SchedulerLeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type SchedulerLeaveRequest = {
  id: string;
  globalUserId: string;
  fieldUserId: string;
  userDisplayName: string;
  userEmail: string;
  userTimezone: string;
  workingDaysMask: number;
  leaveType: SchedulerLeaveType;
  startDate: string;
  endDate: string;
  timezone: string;
  employeeNote: string | null;
  status: SchedulerLeaveStatus;
  reviewedByGlobalUserId: string | null;
  reviewerNote: string | null;
  reviewedAt: string | null;
  cancelledByGlobalUserId: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SchedulerLeaveFilters = {
  globalUserId?: string;
  status?: SchedulerLeaveStatus;
  from?: string;
  to?: string;
};

export type CreateSchedulerLeaveInput = {
  leaveType: SchedulerLeaveType;
  startDate: string;
  endDate: string;
  employeeNote?: string | null;
};

export type ReviewSchedulerLeaveInput = {
  decision: 'approve' | 'reject';
  reviewerNote?: string | null;
  expectedUpdatedAt: string;
};
