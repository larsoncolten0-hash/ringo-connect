// Phase 2B: one small, framework-free engine for the editor's AUTO-SAVING writes (the ones that happen
// without the section's Save button: add/delete/reorder, save-on-blur fields, debounced theme changes).
//
// It exists so that every such write:
//   - is awaited and its Supabase `error` is actually looked at (a thrown error counts too),
//   - never claims success when it failed,
//   - either rolls the UI back to the real saved state (add/delete/reorder), or is kept for a retry
//     (typed text the user would otherwise lose),
//   - is counted while in flight / debounced, so leaving a section can wait for it instead of racing it.
//
// It never talks to the database itself: callers pass the operation. Pure TypeScript so it can be tested
// without React. The React wiring lives in sectionAutosave.tsx.

export type OpResult = { error?: unknown } | null | undefined | void;

export interface RunOptions {
  /** Identifies "the same write" (e.g. one field). A later success of the same key clears an earlier failure. */
  key?: string;
  /** Puts the UI back to the saved state. When given, a failure is UNDONE (no retry is offered). */
  rollback?: () => void;
}

export interface AutosaveSnapshot {
  /** Writes in flight plus writes waiting on a debounce timer. */
  pending: number;
  /** Failed writes the UI still shows but the database does not have; they can be retried. */
  retryable: number;
  /** A write failed and was rolled back: the UI is consistent, the user should just be told. */
  undone: boolean;
  /** Typed input that is not saved because it was never submitted (e.g. a URL typed but not added). */
  uncommitted: number;
}

export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** A Supabase-style result with a truthy `error`. */
export function isFailure(result: unknown): boolean {
  return !!result && typeof result === "object" && "error" in (result as object) && !!(result as { error?: unknown }).error;
}

export function createAutosaveEngine(onChange: (s: AutosaveSnapshot) => void = () => {}, timers: Timers = defaultTimers) {
  let seq = 0;
  let inflight = 0;
  let undone = false;
  const retryables = new Map<string, () => Promise<boolean>>();
  const uncommitted = new Set<string>();
  const scheduled = new Map<string, { handle: unknown; op: () => PromiseLike<OpResult>; opts: RunOptions }>();
  const running = new Set<Promise<void>>();

  const snapshot = (): AutosaveSnapshot => ({
    pending: inflight + scheduled.size,
    retryable: retryables.size,
    undone,
    uncommitted: uncommitted.size,
  });
  const emit = () => onChange(snapshot());

  /** Runs one write. Resolves true only if it really succeeded. */
  async function run(op: () => PromiseLike<OpResult>, opts: RunOptions = {}): Promise<boolean> {
    const key = opts.key ?? `op${++seq}`;
    inflight++;
    emit();
    let ok = false;
    const task = (async () => {
      try {
        ok = !isFailure(await op());
      } catch {
        ok = false;
      }
    })();
    running.add(task);
    await task;
    running.delete(task);
    inflight--;

    if (ok) {
      retryables.delete(key);
      undone = false;
    } else if (opts.rollback) {
      try {
        opts.rollback();
      } catch {
        /* the rollback must never throw into the caller */
      }
      retryables.delete(key);
      undone = true;
    } else {
      retryables.set(key, () => run(op, { ...opts, key }));
    }
    emit();
    return ok;
  }

  /** Debounced write: replaces an earlier pending write with the same key. Counts as pending until it runs. */
  function schedule(key: string, op: () => PromiseLike<OpResult>, ms: number, opts: RunOptions = {}) {
    const prev = scheduled.get(key);
    if (prev) timers.clear(prev.handle);
    const handle = timers.set(() => {
      scheduled.delete(key);
      void run(op, { ...opts, key });
    }, ms);
    scheduled.set(key, { handle, op, opts });
    emit();
  }

  /** Runs every debounced write now and waits for everything in flight. Used before a section is left. */
  async function flush(): Promise<void> {
    const entries = [...scheduled.entries()];
    scheduled.clear();
    for (const [, e] of entries) timers.clear(e.handle);
    await Promise.all(entries.map(([key, e]) => run(e.op, { ...e.opts, key })));
    await Promise.all([...running]);
  }

  /** Re-sends every failed write that was kept for retry. */
  async function retry(): Promise<boolean> {
    const attempts = [...retryables.values()];
    let all = true;
    for (const attempt of attempts) {
      if (!(await attempt())) all = false;
    }
    if (all) undone = false;
    emit();
    return all;
  }

  function setUncommitted(key: string, on: boolean) {
    const had = uncommitted.has(key);
    if (on === had) return;
    if (on) uncommitted.add(key);
    else uncommitted.delete(key);
    emit();
  }

  /** Hides the "was undone" notice. Kept failures stay until retried or discarded. */
  function dismiss() {
    if (!undone) return;
    undone = false;
    emit();
  }

  /** Discard: forget failed writes, pending timers and uncommitted input (the UI is reset by the caller). */
  function reset() {
    for (const [, e] of scheduled) timers.clear(e.handle);
    scheduled.clear();
    retryables.clear();
    uncommitted.clear();
    undone = false;
    emit();
  }

  return { run, schedule, flush, retry, setUncommitted, dismiss, reset, snapshot };
}

export type AutosaveEngine = ReturnType<typeof createAutosaveEngine>;
