import { initDb, isEmpty, meta, wipeDb } from './db.js';
import { seed } from './seed.js';

let ready = false;

export function boot() {
  if (ready) return;
  initDb();
  if (process.argv.includes('--reset') || (meta('seeded') !== '1' && !isEmpty())) wipeDb();
  if (isEmpty()) {
    const summary = seed();
    console.log(`Base de demonstração pronta. Capacidade do kit escova: ${summary.capacity} kits. Gargalo: ${summary.bottleneck}.`);
  }
  ready = true;
}
