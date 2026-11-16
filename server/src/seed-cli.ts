import { createDb, migrate } from './lib/db.js';
import { seedDemo } from './seed.js';

const db = await createDb();
await migrate(db);
const seeded = await seedDemo(db);
console.log(seeded ? 'Demo family seeded. Login: demo@suraksha.app / Demo1234!' : 'Demo family already exists.');
await db.close();
