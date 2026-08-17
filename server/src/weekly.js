import cron from 'node-cron';
import { config } from './config.js';
import { db } from './db.js';
import { sendWeeklySummaryEmail } from './email.js';

export function startWeeklySummary() {
  if (!cron.validate(config.smtp.weeklyCron)) {
    console.error('Resumen semanal desactivado: expresión cron inválida');
    return null;
  }
  return cron.schedule(config.smtp.weeklyCron, async () => {
    const clinics = db.prepare(`SELECT id FROM consultorios WHERE eliminado_en IS NULL`).all();
    for (const clinic of clinics) {
      try {
        await sendWeeklySummaryEmail(clinic.id);
      } catch (error) {
        console.error(`Resumen semanal falló para consultorio ${clinic.id}:`, error.message);
      }
    }
  });
}