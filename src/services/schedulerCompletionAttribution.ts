export type SchedulerCompletionAttributionEvent = {
  id: string;
  status: string;
  updatedAt: Date;
};

/** Active work wins, then newest update, then lexical event ID for exact ties. */
export function compareSchedulerCompletionAttributionEvents(
  left: SchedulerCompletionAttributionEvent,
  right: SchedulerCompletionAttributionEvent,
): number {
  const leftActive = left.status === 'planned' || left.status === 'in_progress' ? 1 : 0;
  const rightActive = right.status === 'planned' || right.status === 'in_progress' ? 1 : 0;
  return rightActive - leftActive
    || right.updatedAt.getTime() - left.updatedAt.getTime()
    || left.id.localeCompare(right.id);
}
