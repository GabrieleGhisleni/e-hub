import { randomUUID } from "node:crypto";
import { currentUserId } from "@ehub/store";
import { toErrorResponse } from "./errors";

type JobState =
  | { state: "running"; progress: string }
  | { state: "done"; result: unknown }
  | { state: "failed"; status: number; error: ReturnType<typeof toErrorResponse>["body"] };

type Job = { owner: string | null; key: string; status: JobState };
const RETAIN_MS = 15 * 60 * 1000;

export function createTranscriptionJobs() {
  const jobs = new Map<string, Job>();
  return {
    start(key: string, run: (progress: (message: string) => void) => Promise<unknown>): string {
      const owner = currentUserId();
      for (const [id, job] of jobs) {
        if (job.owner === owner && job.key === key && job.status.state === "running") return id;
      }
      const id = randomUUID();
      const job: Job = {
        owner,
        key,
        status: { state: "running", progress: "Preparazione dell’audio…" },
      };
      jobs.set(id, job);
      void run((progress) => {
        job.status = { state: "running", progress };
      })
        .then(
          (result) => {
            job.status = { state: "done", result };
          },
          (error: unknown) => {
            const { status, body } = toErrorResponse(error);
            job.status = { state: "failed", status, error: body };
          },
        )
        .finally(() => {
          setTimeout(() => jobs.delete(id), RETAIN_MS).unref();
        });
      return id;
    },
    get(id: string): JobState | undefined {
      const job = jobs.get(id);
      return job && job.owner === currentUserId() ? job.status : undefined;
    },
  };
}
