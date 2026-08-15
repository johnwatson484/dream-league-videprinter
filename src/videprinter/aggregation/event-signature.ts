import type { GoalEvent } from '../types.ts'

type SignatureInput = Pick<GoalEvent, 'scorer' | 'minute' | 'scoreAfterEvent' | 'assist' | 'phase'>

// Captures everything the provider can revise after the fact (scorer corrections, confirmed
// stoppage time, VAR score changes) so callers can tell a genuine correction from a re-send
// of the same goal. `id` is deliberately excluded - it is the immutable identity now.
export function contentSignatureFor (event: SignatureInput): string {
  return JSON.stringify({
    scorer: event.scorer.normalizedName,
    minute: event.minute,
    score: event.scoreAfterEvent,
    assist: event.assist?.normalizedName ?? null,
    phase: event.phase,
  })
}
