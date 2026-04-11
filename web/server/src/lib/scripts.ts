import { spawn } from "node:child_process";

import { repoRoot } from "./paths";

export async function runNodeScript(
  scriptRelPath: string,
  args: string[],
  opts: { log: (line: string) => void }
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("node", [scriptRelPath, ...args], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    child.stdout.on("data", (d) => opts.log(String(d).trimEnd()));
    child.stderr.on("data", (d) => opts.log(String(d).trimEnd()));

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Script failed (${scriptRelPath}) with exit code ${code}`));
    });
  });
}

