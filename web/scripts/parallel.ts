// A small pool of child processes for the long checks. The pin audit and the level statistics
// are one simulation after another with nothing shared between them, so they can be split.
// Two processes is the most this starts. Measured on the 8 GB machine this was written on, for
// the 217 simulations of the pin audit: two processes took 137 s and four took 115 s, because
// four slow each other down, and four is what was running when the machine ran out of memory.
//
// The caller keeps the plan (which sequences to try next, when to stop) and hands the pool one
// simulation at a time; whichever child is free takes it. A caller that prints through inOrder
// gets the same lines in the same order however the work was split.
import { fork, type ChildProcess } from "node:child_process";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";

/// One call for a child to make: an exported function of a module, by name. The arguments and
/// the result cross between processes, so both must be plain data.
export interface Job { module: string; name: string; args: unknown[] }

export const MAX_WORKERS = 2;
const WORKER = "--parallel-worker";

/// How many processes a script was asked to use: "--jobs N" on its command line, from 1 to the
/// most allowed. Without it, the most allowed.
export const jobsAsked = (argv = process.argv): number => {
  const at = argv.indexOf("--jobs"), asked = at > 0 ? Number(argv[at + 1]) : MAX_WORKERS;
  return Number.isInteger(asked) && asked >= 1 ? Math.min(asked, MAX_WORKERS) : MAX_WORKERS;
};

interface Reply { result?: unknown; error?: string }
interface Waiting { job: Job; resolve: (value: unknown) => void; reject: (error: Error) => void }

export class Pool {
  private readonly limit: number;
  private readonly idle: ChildProcess[] = [];
  private readonly busy = new Map<ChildProcess, Waiting>();
  private readonly queue: Waiting[] = [];
  private closed = false;

  constructor(limit = jobsAsked()) {
    this.limit = Math.max(1, Math.min(limit, MAX_WORKERS, availableParallelism()));
  }

  /// Queue one call and resolve with what it returns. Jobs start in the order they were queued.
  run<R>(job: Job): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      this.queue.push({ job, resolve: resolve as (value: unknown) => void, reject });
      this.pump();
    });
  }

  /// Stop the children. Call it once the work is done, or the process will not end.
  close() {
    this.closed = true;
    for (const child of [...this.idle, ...this.busy.keys()]) child.kill();
    this.idle.length = 0;
  }

  private pump() {
    while (this.queue.length > 0 && !this.closed) {
      const child = this.idle.pop() ?? (this.busy.size < this.limit ? this.start() : null);
      if (!child) return;
      const waiting = this.queue.shift()!;
      this.busy.set(child, waiting);
      child.send(waiting.job);
    }
  }

  private start(): ChildProcess {
    // The child inherits this process's loader flags, so it runs TypeScript the same way.
    const child = fork(fileURLToPath(import.meta.url), [WORKER], { execArgv: [...process.execArgv, ...(process.env.POOL_FLAGS ?? "").split(" ").filter(Boolean)] });
    child.on("message", (reply: Reply) => {
      const waiting = this.busy.get(child);
      if (!waiting) return;
      this.busy.delete(child);
      this.idle.push(child);
      if (reply.error !== undefined) waiting.reject(new Error(reply.error));
      else waiting.resolve(reply.result);
      this.pump();
    });
    // A child that dies takes its job with it: the caller hears about it, and the rest carries on.
    child.on("exit", (code) => {
      const at = this.idle.indexOf(child);
      if (at >= 0) this.idle.splice(at, 1);
      const waiting = this.busy.get(child);
      this.busy.delete(child);
      if (waiting && !this.closed) waiting.reject(new Error(`a worker process stopped with code ${code}`));
      this.pump();
    });
    return child;
  }
}

/// Wait for every promise and call `each` with the results in the order of the list, each one as
/// soon as it and all the ones before it are in.
export const inOrder = async <T>(tasks: Promise<T>[], each: (value: T, index: number) => void): Promise<T[]> => {
  const values: T[] = [];
  // A later task that fails while an earlier one is awaited must not count as unhandled; it is thrown when its turn comes.
  for (const task of tasks) task.catch(() => {});
  for (let i = 0; i < tasks.length; i++) {
    values.push(await tasks[i]);
    each(values[i], i);
  }
  return values;
};

/// The module a job names, from a path beside the caller: moduleURL("./pin-suite.ts", import.meta.url).
export const moduleURL = (relative: string, from: string) => new URL(relative, from).href;

// The child's side: one call at a time, until the parent stops it.
if (process.argv[2] === WORKER && process.send) {
  process.on("disconnect", () => process.exit(0));
  process.on("message", (job: Job) => {
    void (async () => {
      let reply: Reply;
      try {
        const module = (await import(job.module)) as Record<string, (...args: unknown[]) => unknown>;
        reply = { result: await module[job.name](...job.args) };
      } catch (error) {
        reply = { error: error instanceof Error ? (error.stack ?? error.message) : String(error) };
      }
      process.send!(reply);
    })();
  });
}
