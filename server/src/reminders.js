import cron from 'node-cron';
import { config } from './config.js';
import { db } from './db.js';
import { sendReminderEmail, smtpConfigured } from './email.js';

function anyEmailConfigured() {
  if (smtpConfigured()) return true;
  return Boolean(db.prepare(`SELECT 1 FROM consultorio_email
    WHERE modo='propio' AND activo=1 AND (
      (oauth_provider='gmail_oauth' AND gmail_refresh_token_cifrado IS NOT NULL)
      OR ((oauth_provider IS NULL OR oauth_provider='smtp') AND smtp_user IS NOT NULL AND smtp_pass_cifrado IS NOT NULL)
    ) LIMIT 1`).get());
}

export function dueReminderRows(now = new Date(), tipo = '24h') {
  const nowIso = now.toISOString();
  const windowSql = tipo === '2h'
    ? `AND datetime(c.inicio) <= datetime(?, '+2 hours')`
    : `AND (
        (co.recordatorio_horas IS NULL AND datetime(?) >= CASE
          WHEN strftime('%H', c.inicio) >= '16' THEN datetime(date(c.inicio) || ' 12:00:00')
          ELSE datetime(date(c.inicio) || ' 00:00:00')
        END)
        OR
        (co.recordatorio_horas IS NOT NULL
          AND datetime(c.inicio) <= datetime(?, '+' || co.recordatorio_horas || ' hours'))
      )`;
  const params = tipo === '2h' ? [nowIso, nowIso] : [nowIso, nowIso, nowIso];
  return db.prepare(`SELECT c.id, c.consultorio_id, p.email
    FROM citas c
    JOIN pacientes p ON p.id = c.paciente_id AND p.consultorio_id = c.consultorio_id
    JOIN consultorios co ON co.id = c.consultorio_id AND co.eliminado_en IS NULL
    LEFT JOIN email_recordatorios er ON er.cita_id = c.id AND er.consultorio_id = c.consultorio_id
      AND er.destinatario = p.email AND er.tipo = ? AND er.estado = 'enviado'
    WHERE c.estado = 'confirmada' AND c.eliminado_en IS NULL AND p.eliminado_en IS NULL
      AND p.email IS NOT NULL AND p.recordatorios_activos = 1 AND er.id IS NULL
      AND datetime(c.inicio) > datetime(?)
      ${windowSql}`).all(tipo, ...params);
}

export function expireFunctionTrials(now = new Date()) {
  const cutoff = now.toISOString();
  const result = db.prepare(`UPDATE funciones_consultorio SET activo=0, actualizado_en=CURRENT_TIMESTAMP
    WHERE activo=1 AND funcion='correos_automaticos' AND vence_en IS NOT NULL AND vence_en <= ?`).run(cutoff);
  if (result.changes > 0) {
    console.log(`Pruebas de correos automáticos vencidas: ${result.changes}`);
  }
  return result.changes;
}

function recordReminder(row, tipo, error = null) {
  db.prepare(`INSERT INTO email_recordatorios
    (consultorio_id, cita_id, destinatario, tipo, estado, error) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(consultorio_id, cita_id, destinatario) DO UPDATE SET
      tipo=excluded.tipo, estado=excluded.estado, error=excluded.error, creado_en=CURRENT_TIMESTAMP`)
    .run(row.consultorio_id, row.id, row.email, tipo, error ? 'error' : 'enviado', error);
}

async function runReminders(tipo) {
  const rows = dueReminderRows(new Date(), tipo);
  for (const row of rows) {
    try {
      const sent = await sendReminderEmail(row.id, tipo);
      recordReminder(row, tipo, sent ? null : 'Correo no enviado: sin SMTP configurado para esta clínica');
    } catch (error) {
      recordReminder(row, tipo, String(error.message).slice(0, 500));
    }
  }
}

export function startReminders() {
  if (!anyEmailConfigured()) {
    console.log('Recordatorios por correo desactivados: sin SMTP global ni correos de consultorios configurados');
    return null;
  }
  const jobs = [];
  const schedules = [
    { expr: config.smtp.cron, tipo: '24h' },
    { expr: config.smtp.cron2h, tipo: '2h' },
  ];
  for (const { expr, tipo } of schedules) {
    if (!cron.validate(expr)) {
      console.error(`Recordatorios ${tipo} desactivados: expresión cron inválida`);
      continue;
    }
    jobs.push(cron.schedule(expr, async () => {
      expireFunctionTrials();
      await runReminders(tipo);
    }));
  }
  return jobs;
}