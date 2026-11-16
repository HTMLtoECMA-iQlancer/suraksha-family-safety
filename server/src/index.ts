import { env } from './config.js';
import { createApp } from './app.js';

const context = await createApp();

context.server.listen(env.port, () => {
  console.log('');
  console.log('  Suraksha Family Safety');
  console.log(`  API + parent dashboard: http://localhost:${env.port}`);
  console.log(`  Child companion preview: http://localhost:${env.port}/child`);
  console.log(`  Database: ${context.db.kind}`);
  console.log(`  Demo mode: ${env.demoMode ? 'ON' : 'off'}`);
  if (env.demoMode) {
    console.log('  Demo login: demo@suraksha.app / Demo1234!');
  }
  if (!env.turnUrls.length) {
    console.log('  TURN relay: not configured (public STUN only; see docs/DEPLOYMENT.md)');
  }
  console.log('');
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[suraksha] ${signal} received, shutting down`);
  try {
    await context.close();
  } catch (err) {
    console.error('[suraksha] shutdown error', err);
  }
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
