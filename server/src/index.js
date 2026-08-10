import { app } from './app.js';
import { config } from './config.js';
import { db } from './db.js';
import { startReminders } from './reminders.js';
import { startBackups } from './backup.js';
import { startMaintenance } from './maintenance.js';

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`Servidor dental escuchando en 0.0.0.0:${config.port}`);
  startReminders();
  startBackups();
  startMaintenance();
});

function shutdown(signal) {
  console.log(`${signal} recibido; cerrando el servidor`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
