import cron from 'node-cron';
import { config } from './config.js';
import { db } from './db.js';
import { sendReminderEmail, smtpConfigured } from './email.js';

function anyEmailConfigured() {
  if (smtpConfigured()) return true;
  return Boolean(db.prepare(`SELECT 1 FROM consultorio_email
    WHERE modo='propio' AND activo=1 AND smtp_user IS NOT NULL AND smtp_pass_cifrado IS NOT NULL
    LIMIT 1`).get());
}

export function startReminders() {
  if (!anyEmailConfigured()) {
    console.log('Recordatorios por correo desactivados: sin SMTP global ni correos de consultorios configurados');
    return null;
  }
  if (!cron.validate(config.smtp.cron)) {
    console.error('Recordatorios por correo desactivados: expresión cron inválida');
    return null;
  }
  return cron.schedule(config.smtp.cron, async () => {
    const rows = db.prepare(`SELECT c.id, c.consultorio_id, p.email
      FROM citas c
      JOIN pacientes p ON p.id = c.paciente_id AND p.consultorio_id = c.consultorio_id
      JOIN consultorios co ON co.id = c.consultorio_id AND co.eliminado_en IS NULL
      LEFT JOIN email_recordatorios er ON er.cita_id = c.id AND er.consultorio_id = c.consultorio_id
        AND er.destinatario = p.email AND er.estado = 'enviado'
      WHERE c.estado = 'confirmada' AND c.eliminado_en IS NULL AND p.eliminado_en IS NULL
        AND p.email IS NOT NULL AND p.recordatorios_activos = 1 AND er.id IS NULL
        AND datetime(c.inicio) BETWEEN datetime('now') AND datetime('now', ?)`)
      .all(`+${config.smtp.hours} hours`);
    for (const row of rows) {
      try {
        const sent = await sendReminderEmail(row.id);
        if (sent) {
          db.prepare(`INSERT INTO email_recordatorios
            (consultorio_id, cita_id, destinatario, estado, error) VALUES (?, ?, ?, 'enviado', NULL)
            ON CONFLICT(consultorio_id, cita_id, destinatario) DO UPDATE SET estado='enviado', error=NULL, creado_en=CURRENT_TIMESTAMP`)
            .run(row.consultorio_id, row.id, row.email);
        } else {
          db.prepare(`INSERT INTO email_recordatorios
            (consultorio_id, cita_id, destinatario, estado, error) VALUES (?, ?, ?, 'error', ?)
            ON CONFLICT(consultorio_id, cita_id, destinatario) DO UPDATE SET estado='error', error=excluded.error, creado_en=CURRENT_TIMESTAMP`)
            .run(row.consultorio_id, row.id, row.email, 'Correo no enviado: sin SMTP configurado para esta clínica');
        }
      } catch (error) {
        db.prepare(`INSERT INTO email_recordatorios
          (consultorio_id, cita_id, destinatario, estado, error) VALUES (?, ?, ?, 'error', ?)
          ON CONFLICT(consultorio_id, cita_id, destinatario) DO UPDATE SET estado='error', error=excluded.error, creado_en=CURRENT_TIMESTAMP`)
          .run(row.consultorio_id, row.id, row.email, String(error.message).slice(0, 500));
      }
    }
  });
}