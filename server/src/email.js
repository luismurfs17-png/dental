import nodemailer from 'nodemailer';
import { config } from './config.js';
import { db } from './db.js';
import { decryptSecret } from './crypto.js';
import { buildAppointmentMail, buildReminderMail, buildQuoteMail, buildSimpleMail } from './templates.js';

const clinicTransporters = new Map();
let globalTransporter;

export function smtpConfigured() {
  return Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);
}

export function getClinicEmailConfig(consultorioId) {
  const row = db.prepare(`SELECT modo, oauth_provider, smtp_host, smtp_port, smtp_secure, smtp_user,
      smtp_from, gmail_user, gmail_refresh_token_cifrado, gmail_access_token_cifrado,
      gmail_access_token_expira_en, activo, verificado_en, ultimo_error
    FROM consultorio_email WHERE consultorio_id = ?`).get(consultorioId);
  if (!row || row.modo !== 'propio' || !row.activo) return null;
  if (row.oauth_provider === 'gmail_oauth') {
    if (!row.gmail_user || !row.gmail_refresh_token_cifrado) return null;
    return row;
  }
  if (!row.smtp_user) return null;
  return row;
}

function getGlobalTransporter() {
  globalTransporter ||= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass }
  });
  return globalTransporter;
}

function createClinicTransporter(row) {
  if (row.oauth_provider === 'gmail_oauth') {
    const secrets = db.prepare(`SELECT gmail_refresh_token_cifrado, gmail_access_token_cifrado
      FROM consultorio_email WHERE consultorio_id = ?`).get(row.consultorio_id);
    const refreshToken = decryptSecret(secrets?.gmail_refresh_token_cifrado);
    if (!refreshToken) return null;
    return nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        type: 'OAuth2',
        user: row.gmail_user,
        clientId: config.google.clientId,
        clientSecret: config.google.clientSecret,
        refreshToken,
        accessToken: decryptSecret(secrets?.gmail_access_token_cifrado) || undefined,
        expires: row.gmail_access_token_expira_en ? new Date(row.gmail_access_token_expira_en).getTime() : undefined
      }
    });
  }
  const pass = decryptSecret(db.prepare(`SELECT smtp_pass_cifrado FROM consultorio_email
    WHERE consultorio_id = ?`).get(row.consultorio_id)?.smtp_pass_cifrado);
  if (!pass) return null;
  return nodemailer.createTransport({
    host: row.smtp_host,
    port: row.smtp_port,
    secure: Boolean(row.smtp_secure),
    auth: { user: row.smtp_user, pass }
  });
}

export function clearClinicTransporter(consultorioId) {
  clinicTransporters.delete(consultorioId);
}

function transporterFor(consultorioId) {
  const clinicConfig = consultorioId ? getClinicEmailConfig(consultorioId) : null;
  if (clinicConfig) {
    let transporter = clinicTransporters.get(consultorioId);
    if (!transporter) {
      transporter = createClinicTransporter(clinicConfig);
      if (transporter) clinicTransporters.set(consultorioId, transporter);
    }
    if (transporter) return { transporter, from: clinicConfig.smtp_from || config.smtp.from };
  }
  return { transporter: getGlobalTransporter(), from: config.smtp.from };
}

function recordSend({ consultorioId, citaId, destinatario, tipo, estado, error, intentos }) {
  if (!consultorioId) return;
  try {
    db.prepare(`INSERT INTO envios_notificacion
      (consultorio_id, cita_id, destinatario, tipo, canal, estado, error, intentos)
      VALUES (?, ?, ?, ?, 'email', ?, ?, ?)`).run(
      consultorioId, citaId || null, destinatario || null, tipo, estado,
      error ? String(error).slice(0, 500) : null, intentos);
  } catch (recordError) {
    console.warn('No se pudo registrar el envío de correo:', recordError.message);
  }
}

export async function sendEmail(message, { consultorioId = null, citaId = null, tipo = 'general' } = {}) {
  const clinicConfig = consultorioId ? getClinicEmailConfig(consultorioId) : null;
  if (!clinicConfig && !smtpConfigured()) return false;
  const { transporter, from } = transporterFor(consultorioId);
  let attempts = 0;
  for (;;) {
    attempts += 1;
    try {
      await transporter.sendMail({ from, ...message });
      recordSend({ consultorioId, citaId, destinatario: message.to, tipo, estado: 'enviado', error: null, intentos: attempts });
      return true;
    } catch (error) {
      if (attempts < 2) continue;
      recordSend({ consultorioId, citaId, destinatario: message.to, tipo, estado: 'error', error: error.message, intentos: attempts });
      return false;
    }
  }
}

function appointmentForEmail(appointmentId) {
  return db.prepare(`SELECT c.id, c.consultorio_id, c.inicio, c.fin, c.precio_bs, p.email, p.nombres paciente,
      p.recordatorios_activos, u.nombre doctor, s.nombre servicio, co.nombre consultorio, co.marca_nombre,
      co.telefono, co.slug, co.logo_path, co.color_primario, co.color_acento, co.eslogan,
      co.whatsapp, co.facebook, co.instagram
    FROM citas c
    JOIN pacientes p ON p.id=c.paciente_id AND p.consultorio_id=c.consultorio_id
    JOIN usuarios u ON u.id=c.doctor_id AND u.consultorio_id=c.consultorio_id
    JOIN servicios s ON s.id=c.servicio_id AND s.consultorio_id=c.consultorio_id
    JOIN consultorios co ON co.id=c.consultorio_id
    WHERE c.id=? AND c.eliminado_en IS NULL`).get(appointmentId);
}

export async function sendAppointmentEmail(appointmentId, type) {
  const appointment = appointmentForEmail(appointmentId);
  if (!appointment?.email || !appointment.recordatorios_activos) return false;
  const mail = buildAppointmentMail(appointment, type);
  return sendEmail({ to: appointment.email, ...mail }, {
    consultorioId: appointment.consultorio_id,
    citaId: appointment.id,
    tipo: type
  });
}

export async function sendReminderEmail(appointmentId) {
  const appointment = appointmentForEmail(appointmentId);
  if (!appointment?.email || !appointment.recordatorios_activos) return false;
  const mail = buildReminderMail(appointment);
  return sendEmail({ to: appointment.email, ...mail }, {
    consultorioId: appointment.consultorio_id,
    citaId: appointment.id,
    tipo: 'recordatorio'
  });
}

export async function sendClinicEmail({ consultorioId, to, patientName, subject, heading, lines, actionUrl, actionLabel, tipo }) {
  const clinic = db.prepare(`SELECT nombre, marca_nombre, telefono, slug, logo_path, color_primario, color_acento, eslogan, whatsapp, facebook, instagram
    FROM consultorios WHERE id=? AND eliminado_en IS NULL`).get(consultorioId);
  if (!clinic) return false;
  const mail = buildSimpleMail({ clinic, patientName, subject, heading, lines, actionUrl, actionLabel });
  return sendEmail({ to, ...mail }, { consultorioId, tipo });
}

export async function sendTestEmail(consultorioId, to) {
  const clinic = db.prepare(`SELECT nombre, marca_nombre, telefono, slug, logo_path, color_primario, color_acento, eslogan, whatsapp, facebook, instagram
    FROM consultorios WHERE id=? AND eliminado_en IS NULL`).get(consultorioId);
  if (!clinic) throw new Error('Consultorio no encontrado');
  const mail = buildSimpleMail({
    clinic,
    patientName: 'equipo',
    subject: `Correo de prueba - ${clinic.marca_nombre || clinic.nombre}`,
    heading: 'Correo de prueba',
    lines: ['Si recibes este correo, la configuración de correo de tu consultorio funciona correctamente.']
  });
  return sendEmail({ to, ...mail }, { consultorioId, tipo: 'prueba' });
}

export async function sendWelcomeEmail({ consultorioId, to, patientName, portalUrl, installUrl }) {
  const clinic = db.prepare(`SELECT nombre, marca_nombre, telefono, slug, logo_path, color_primario, color_acento, eslogan, whatsapp, facebook, instagram
    FROM consultorios WHERE id=? AND eliminado_en IS NULL`).get(consultorioId);
  if (!clinic) return false;
  const mail = buildSimpleMail({
    clinic,
    patientName,
    subject: `Bienvenido a ${clinic.marca_nombre || clinic.nombre}`,
    heading: 'Tu consultorio digital está listo',
    lines: [
      'Tu cuenta fue creada con este correo.',
      'Entra con tu cuenta de Google para agendar, ver citas y consultar tus pagos.',
      'Instala la aplicación en tu teléfono para tenerla siempre a mano.'
    ],
    actionUrl: portalUrl,
    actionLabel: 'Abrir mi consultorio',
    secondaryUrl: installUrl,
    secondaryLabel: 'Instalar en mi teléfono'
  });
  return sendEmail({ to, ...mail }, { consultorioId, tipo: 'bienvenida' });
}

export async function sendPlatformEmail({ to, name, subject, heading, lines, actionUrl, actionLabel }) {
  if (!smtpConfigured()) return false;
  const mail = buildSimpleMail({ clinic: {}, patientName: name, subject, heading, lines, actionUrl, actionLabel });
  return sendEmail({ to, ...mail }, { tipo: 'plataforma' });
}

export async function sendQuoteEmail(quoteId) {
  const quote = db.prepare(`SELECT pr.id, pr.consultorio_id, pr.paciente_id, pr.titulo, pr.notas, pr.estado, pr.creado_en, pr.token_publico,
      p.nombres, p.apellidos, p.email,
      co.nombre, co.marca_nombre, co.telefono, co.slug, co.logo_path, co.color_primario, co.color_acento,
      co.eslogan, co.whatsapp, co.facebook, co.instagram, co.ubicacion
    FROM presupuestos pr
    JOIN pacientes p ON p.id=pr.paciente_id AND p.consultorio_id=pr.consultorio_id
    JOIN consultorios co ON co.id=pr.consultorio_id
    WHERE pr.id=? AND pr.eliminado_en IS NULL`).get(quoteId);
  if (!quote?.email) return false;
  const items = db.prepare(`SELECT nombre, cantidad, precio_bs, detalle FROM presupuesto_items
    WHERE presupuesto_id=? AND eliminado_en IS NULL ORDER BY posicion,id`).all(quoteId)
    .map((row) => {
      let detail = [];
      try { detail = row.detalle ? JSON.parse(row.detalle) : []; } catch { detail = []; }
      return { ...row, detalle: detail };
    });
  const summary = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN total_bs IS NULL THEN 0 ELSE total_bs END), 0) total_bs,
      COALESCE(SUM(CASE WHEN total_bs IS NULL THEN 1 ELSE 0 END), 0) sin_precio
    FROM presupuesto_items WHERE presupuesto_id=? AND eliminado_en IS NULL`).get(quoteId);
  const pago = db.prepare(`SELECT COALESCE(SUM(monto_bs),0) pagado_bs FROM pagos
    WHERE presupuesto_id=? AND estado='valido' AND eliminado_en IS NULL`).get(quoteId);
  const saldo = Math.max(0, Number(summary.total_bs || 0) - Number(pago.pagado_bs || 0));
  const patientName = `${quote.nombres} ${quote.apellidos}`.trim();
  const quoteUrl = `${config.clientUrl}/cotizacion/${quote.token_publico}`;
  const mail = buildQuoteMail({
    clinic: quote,
    patientName,
    subject: `Tu cotización - ${quote.marca_nombre || quote.nombre}`,
    heading: quote.titulo || 'Tu plan de tratamiento',
    items,
    resumen: summary,
    pago: { pagado_bs: Number(pago.pagado_bs || 0), saldo_bs: saldo },
    quoteUrl,
    created: quote.creado_en
  });
  return sendEmail({ to: quote.email, ...mail }, { consultorioId: quote.consultorio_id, tipo: 'cotizacion' });
}