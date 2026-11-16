import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const deadline = Date.now() + 600000;
const jobs = [
  { file: 'commutators.ts', seconds: 125, heap: 64 },
  { file: 'stabilizers.ts', seconds: 190, heap: 64 },
  { file: 'strategies.ts', seconds: 190, heap: 128 },
  { file: 'assemble.ts', seconds: 60, heap: 128 },
  { file: 'verify.ts', seconds: 60, heap: 64 },
];
console.log('Research limits: 600 seconds total; per-process heap 64/128 MiB; each search also has explicit state/depth/time/RSS limits.');
for (const job of jobs) {
  const timeout = Math.min(job.seconds * 1000, deadline - Date.now());
  if (timeout <= 0) throw new Error('Total research deadline reached');
  console.log(`\n--- ${job.file} (timeout ${timeout} ms) ---`);
  const result = spawnSync(process.execPath, ['--max-old-space-size=' + job.heap, '--max-semi-space-size=4', '--experimental-strip-types', 'scripts/research/' + job.file], {
    cwd: root, stdio: 'inherit', timeout,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${job.file} failed (${result.status ?? result.signal}); results are not certified complete.`);
}
console.log('\nPASS: bounded research regeneration and official-model artifact replay completed. UI and blog were not modified.');
