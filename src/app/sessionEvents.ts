import type { SessionEvent, SessionTab } from "../entities/domain";

const MAX_SESSION_OUTPUT_CHARS = 200_000;

function appendSessionOutput(base: string, addition: string): string {
  if (!addition) {
    return base;
  }

  const next = `${base}${addition}`;
  if (next.length <= MAX_SESSION_OUTPUT_CHARS) {
    return next;
  }

  return next.slice(-MAX_SESSION_OUTPUT_CHARS);
}

/**
 * Merges backend-driven session events into the in-memory tab list.
 */
export function mergeSessionEvent(sessions: SessionTab[], event: SessionEvent): SessionTab[] {
  let mutated = false;

  const updated = sessions.map((session) => {
    if (session.id !== event.sessionId) {
      return session;
    }

    mutated = true;

    if (event.kind === "output") {
      return {
        ...session,
        lastOutput: appendSessionOutput(session.lastOutput, event.chunk),
        updatedAt: event.occurredAt,
      };
    }

    const next = {
      ...session,
      status: event.status ?? session.status,
      updatedAt: event.occurredAt,
    } satisfies SessionTab;

    if (event.message) {
      next.lastOutput = appendSessionOutput(session.lastOutput, event.message);
    }

    return next;
  });

  return mutated ? updated : sessions;
}
