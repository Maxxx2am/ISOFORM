/**
 * Catches uncaught JS errors that happen OUTSIDE React's render cycle (a
 * throw in a useEffect, an unhandled promise rejection, a timer callback) —
 * things a <ErrorBoundary> alone never sees, since that only catches errors
 * thrown while rendering. Without this, an error here just silently does
 * nothing visible in a production build (no Metro red box like Expo Go), so
 * a startup crash of this kind would look exactly like a stuck blank screen.
 */
type Listener = (error: Error, isFatal: boolean) => void;
let listener: Listener | null = null;
let pending: { error: Error; isFatal: boolean } | null = null;

export function onFatalError(cb: Listener): () => void {
  listener = cb;
  if (pending) {
    cb(pending.error, pending.isFatal);
    pending = null;
  }
  return () => {
    if (listener === cb) listener = null;
  };
}

export function installGlobalErrorHandler() {
  const g = global as { ErrorUtils?: { setGlobalHandler: (h: Listener) => void; getGlobalHandler: () => Listener } };
  if (!g.ErrorUtils) return;
  const previous = g.ErrorUtils.getGlobalHandler();
  g.ErrorUtils.setGlobalHandler((error, isFatal) => {
    if (listener) listener(error, !!isFatal);
    else pending = { error, isFatal: !!isFatal };
    previous?.(error, isFatal);
  });
}
