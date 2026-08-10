import cron from 'node-cron';
import { config } from './config.js';
import { db } from './db.js';
import { sendEmail, smtpConfigured } from './email.js';

export function startReminders() {
  if (!smtpConfigured()) {
    console.log('Recordatorios por correo desactivados: SMTP no configurado');
    return null;
  }
  if (!cron.validate(config.smtp.cron)) {
    console.error('Recordatorios por correo desactivados: expresión cron inválida');
    return null;
  }
  return cron.schedule(config.smtp.cron, async () => {
    const rows = db.prepare(`SELECT c.id, c.consultorio_id, c.inicio, c.precio_bs, p.email, p.nombres,
      co.nombre consultorio, s.nombre servicio
      FROM citas c
      JOIN pacientes p ON p.id = c.paciente_id AND p.consultorio_id = c.consultorio_id
      JOIN consultorios co ON co.id = c.consultorio_id
      JOIN servicios s ON s.id = c.servicio_id AND s.consultorio_id = c.consultorio_id
      LEFT JOIN email_recordatorios er ON er.cita_id = c.id AND er.consultorio_id = c.consultorio_id
        AND er.destinatario = p.email AND er.estado = 'enviado'
      WHERE c.estado = 'confirmada' AND c.eliminado_en IS NULL AND p.eliminado_en IS NULL
        AND p.email IS NOT NULL AND p.recordatorios_activos = 1 AND er.id IS NULL
        AND datetime(c.inicio) BETWEEN datetime('now') AND datetime('now', ?)`)
      .all(`+${config.smtp.hours} hours`);
    for (const row of rows) {
      try {
        const date = new Intl.DateTimeFormat('es-BO', { timeZone: 'America/La_Paz', dateStyle: 'full', timeStyle: 'short' }).format(new Date(row.inicio));
        const price = row.precio_bs === null ? 'Precio: se define en la consulta.' : `Precio: Bs ${new Intl.NumberFormat('es-BO', { maximumFractionDigits: 2 }).format(row.precio_bs)}`;
        await sendEmail({
          to: row.email,
          subject: `Recordatorio de cita - ${row.consultorio}`,
          text: `Hola ${row.nombres}, le recordamos su cita de ${row.servicio} para ${date}. ${price} Consultorio: ${row.consultorio}.`
        });
        db.prepare(`INSERT INTO email_recordatorios
          (consultorio_id, cita_id, destinatario, estado, error) VALUES (?, ?, ?, 'enviado', NULL)
          ON CONFLICT(consultorio_id, cita_id, destinatario) DO UPDATE SET estado='enviado', error=NULL, creado_en=CURRENT_TIMESTAMP`)
          .run(row.consultorio_id, row.id, row.email);
      } catch (error) {
        db.prepare(`INSERT INTO email_recordatorios
          (consultorio_id, cita_id, destinatario, estado, error) VALUES (?, ?, ?, 'error', ?)
          ON CONFLICT(consultorio_id, cita_id, destinatario) DO UPDATE SET estado='error', error=excluded.error, creado_en=CURRENT_TIMESTAMP`)
          .run(row.consultorio_id, row.id, row.email, String(error.message).slice(0, 500));
      }
    }
  });
}
