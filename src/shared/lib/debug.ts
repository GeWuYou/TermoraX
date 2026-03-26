const DEBUG_PREFIX = "[termorax][frontend]";

function readBrowserFlag(flag: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const query = new URLSearchParams(window.location.search);
  const queryValue = query.get(flag);
  if (queryValue === "1" || queryValue === "true") {
    return true;
  }

  try {
    const storedValue = window.localStorage.getItem(flag);
    return storedValue === "1" || storedValue === "true";
  } catch {
    return false;
  }
}

export function isDebugFlagEnabled(flag: string): boolean {
  return import.meta.env.DEV && readBrowserFlag(flag);
}

export function debugLog(flag: string, event: string, payload: Record<string, unknown>) {
  if (!isDebugFlagEnabled(flag)) {
    return;
  }

  console.info(`${DEBUG_PREFIX} ${event}`, payload);
}
