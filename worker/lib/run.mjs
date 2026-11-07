// Runs ffmpeg and ffprobe. The job takes `run` as a dependency so the tests
// can swap in a fake.
import { spawn } from "node:child_process";

/**
 * Runs a command and resolves with its stdout when it exits with 0.
 * Rejects with the last lines of stderr otherwise. The signal kills it.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string, signal?: AbortSignal, onStdout?: (chunk: string) => void }} [opts]
 */
export function run(cmd, args, { cwd, signal, onStdout } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const kill = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", kill, { once: true });
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      if (onStdout) onStdout(chunk);
      else stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on("error", (err) => {
      signal?.removeEventListener("abort", kill);
      reject(err);
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", kill);
      if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
      if (code === 0) return resolve(stdout);
      const tail = stderr.trim().split("\n").slice(-3).join(" | ");
      reject(new Error(`${cmd} exited with ${code}${tail ? `: ${tail}` : ""}`));
    });
  });
}
