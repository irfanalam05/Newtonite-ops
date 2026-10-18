import { config } from '../config/index.js';
import { pool } from '../db/pool.js';
import { defaultHandlers } from './handlers.js';
import { processBatch } from './outbox.js';

let stopping = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`[worker] started, polling every ${config.worker.pollMs}ms`);
  while (!stopping) {
    try {
      const stats = await processBatch(defaultHandlers);
      if (stats.claimed > 0) console.log('[worker] batch', JSON.stringify(stats));
      if (stats.claimed < config.worker.batchSize) await sleep(config.worker.pollMs);
    } catch (err) {
      // e.g. database briefly unavailable: log and keep polling
      console.error('[worker] poll error:', err.message);
      await sleep(config.worker.pollMs);
    }
  }
  await pool.end();
  console.log('[worker] stopped');
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopping = true; });
main();
