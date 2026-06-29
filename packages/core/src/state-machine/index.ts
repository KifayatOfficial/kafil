// §4.3 (amended) — assignment-state transitions as DATA, not branching code.
// This is the single source of truth consumed by both the API (validate transitions)
// and the clients (decide what UI actions to show, what label, what motion class).
//
// §26/M1 — the `awaiting_ops_review` evidence-fallback is encoded. The deprecated
// §24/A6 "auto-complete in employer's favor" path is intentionally absent.

import type { AssignmentStatus } from '../schemas/assignment';

export type Actor = 'worker' | 'employer' | 'system' | 'ops';

export type TransitionName =
  | 'accept_application'
  | 'worker_confirm'
  | 'worker_decline'
  | 'expire_unconfirmed'
  | 'start' // confirmed → in_progress
  | 'pause'
  | 'resume'
  | 'worker_mark_done'
  | 'employer_mark_done'
  | 'both_done_to_completed'
  | 'silence_route_to_ops_review' // §26/M1
  | 'ops_resolve_to_completed'
  | 'ops_resolve_to_disputed'
  | 'enter_review_window'
  | 'finalize'
  | 'cancel_by_employer'
  | 'cancel_by_worker'
  | 'report_no_show'
  | 'open_dispute';

export interface TransitionDef {
  name: TransitionName;
  from: AssignmentStatus[];
  to: AssignmentStatus;
  by: Actor[];
  // High-level guards; service layer enforces; declared here so client UI can hide actions.
  guards: string[];
}

export const transitions: readonly TransitionDef[] = [
  {
    name: 'accept_application',
    from: ['assigned'],
    to: 'assigned',
    by: ['employer'],
    guards: ['slot_open', 'worker_not_banned', 'optimistic_lock_slot', 'idempotent'],
  },
  {
    name: 'worker_confirm',
    from: ['assigned'],
    to: 'confirmed',
    by: ['worker'],
    guards: ['within_confirm_window'],
  },
  {
    name: 'worker_decline',
    from: ['assigned'],
    to: 'declined',
    by: ['worker'],
    guards: [],
  },
  {
    name: 'expire_unconfirmed',
    from: ['assigned'],
    to: 'expired',
    by: ['system'],
    guards: ['confirm_window_elapsed', 'advisory_lock'],
  },
  {
    name: 'start',
    from: ['confirmed'],
    to: 'in_progress',
    by: ['system'],
    guards: ['start_date_reached'],
  },
  {
    name: 'pause',
    from: ['in_progress'],
    to: 'paused',
    by: ['worker', 'employer'],
    guards: ['both_confirm_or_evidence'],
  },
  {
    name: 'resume',
    from: ['paused'],
    to: 'in_progress',
    by: ['worker', 'employer'],
    guards: [],
  },
  // §4 — "mark done" works from in_progress AND from the awaiting_* state where the
  // counter-party has already marked done. In the latter case the service layer detects
  // both timestamps set and rolls forward to `completed` (see assignment.service.ts).
  {
    name: 'worker_mark_done',
    from: ['in_progress', 'awaiting_worker_confirm'],
    to: 'awaiting_employer_confirm',
    by: ['worker'],
    guards: ['idempotent'],
  },
  {
    name: 'employer_mark_done',
    from: ['in_progress', 'awaiting_employer_confirm'],
    to: 'awaiting_worker_confirm',
    by: ['employer'],
    guards: ['idempotent'],
  },
  {
    name: 'both_done_to_completed',
    from: ['awaiting_employer_confirm', 'awaiting_worker_confirm'],
    to: 'completed',
    by: ['system'],
    guards: ['both_marked_done'],
  },
  // §26/M1 — silence past T routes to ops review, NOT to a directional auto-complete.
  {
    name: 'silence_route_to_ops_review',
    from: ['awaiting_employer_confirm', 'awaiting_worker_confirm'],
    to: 'awaiting_ops_review',
    by: ['system'],
    guards: ['silence_past_T', 'insufficient_evidence'],
  },
  {
    name: 'ops_resolve_to_completed',
    from: ['awaiting_ops_review'],
    to: 'completed',
    by: ['ops'],
    guards: ['ops_decision_recorded'],
  },
  {
    name: 'ops_resolve_to_disputed',
    from: ['awaiting_ops_review'],
    to: 'disputed',
    by: ['ops'],
    guards: ['ops_decision_recorded'],
  },
  // §6.2 — risk-tiered: low risk skips review_window; medium/high enter it.
  {
    name: 'enter_review_window',
    from: ['completed'],
    to: 'in_review_window',
    by: ['system'],
    guards: ['hold_minutes_gt_0'],
  },
  {
    name: 'finalize',
    from: ['completed', 'in_review_window'],
    to: 'finalized',
    by: ['system'],
    guards: ['hold_elapsed_or_low_risk', 'no_open_dispute'],
  },
  {
    name: 'cancel_by_employer',
    from: ['assigned', 'confirmed'],
    to: 'cancelled_by_employer',
    by: ['employer'],
    guards: ['pre_start'],
  },
  {
    name: 'cancel_by_worker',
    from: ['assigned', 'confirmed'],
    to: 'cancelled_by_worker',
    by: ['worker'],
    guards: ['pre_start'],
  },
  {
    name: 'report_no_show',
    from: ['confirmed', 'in_progress'],
    to: 'no_show',
    by: ['employer'],
    guards: ['start_grace_elapsed'],
  },
  {
    name: 'open_dispute',
    from: [
      'assigned',
      'confirmed',
      'in_progress',
      'paused',
      'awaiting_employer_confirm',
      'awaiting_worker_confirm',
      'completed',
      'in_review_window',
    ],
    to: 'disputed',
    by: ['worker', 'employer'],
    guards: ['within_dispute_window', 'evidence_attached'],
  },
] as const;

export function canTransition(
  from: AssignmentStatus,
  name: TransitionName,
  by: Actor,
): boolean {
  const def = transitions.find((t) => t.name === name);
  if (!def) return false;
  return def.from.includes(from) && def.by.includes(by);
}

export function nextStatus(
  from: AssignmentStatus,
  name: TransitionName,
): AssignmentStatus | null {
  const def = transitions.find((t) => t.name === name);
  if (!def || !def.from.includes(from)) return null;
  return def.to;
}
