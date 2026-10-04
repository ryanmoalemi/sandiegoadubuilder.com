import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync("python3", ["scripts/optimize-images.py"], {
  cwd: root,
  stdio: "inherit"
});

if (result.error) {
  console.error(`IMAGE_OPTIMIZE_FAILURE: ${result.error.message}`);
} else if (result.status) {
  console.error(`IMAGE_OPTIMIZE_FAILURE: optimizer exited ${result.status}. Publishing continues.`);
}

process.exit(0);
