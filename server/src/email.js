import nodemailer from 'nodemailer';
import { config } from './config.js';
import { db } from './db.js';
import { decryptSecret } from './crypto.js';
import { buildAppointmentMail, buildReminderMail, buildSimpleMail } from './templates.js';

const clinicTransporters = new Map();
let globalTransporter;

export function smtpConfigured() {
  return Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);
}

export function getClinicEmailConfig(consultorioId) {
  const row = db.prepare(`SELECT modo, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_from,
      activo, verificado_en, ultimo_error
    FROM consultorio_email WHERE consultorio_id = ?`).get(consultorioId);
  if (!row || row.modo !== 'propio' || !row.activo || !row.smtp_user) return null;
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
      co.telefono, co.slug, co.logo_path, co.color_primario, co.color_acento
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
  const clinic = db.prepare(`SELECT nombre, marca_nombre, telefono, slug, logo_path, color_primario, color_acento
    FROM consultorios WHERE id=? AND eliminado_en IS NULL`).get(consultorioId);
  if (!clinic) return false;
  const mail = buildSimpleMail({ clinic, patientName, subject, heading, lines, actionUrl, actionLabel });
  return sendEmail({ to, ...mail }, { consultorioId, tipo });
}

export async function sendTestEmail(consultorioId, to) {
  const clinic = db.prepare(`SELECT nombre, marca_nombre, telefono, slug, logo_path, color_primario, color_acento
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
  const clinic = db.prepare(`SELECT nombre, marca_nombre, telefono, slug, logo_path, color_primario, color_acento
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