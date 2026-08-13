import nodemailer from 'nodemailer';
import { config } from './config.js';
import { db } from './db.js';

let transporter;

export function smtpConfigured() {
  return Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);
}

export function sendEmail(message) {
  if (!smtpConfigured()) return Promise.resolve(false);
  transporter ||= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass }
  });
  return transporter.sendMail({ from: config.smtp.from, ...message }).then(() => true);
}

export async function sendAppointmentEmail(appointmentId, type) {
  if (!smtpConfigured()) return false;
  const appointment = db.prepare(`SELECT c.inicio,c.fin,c.precio_bs,p.email,p.nombres,p.recordatorios_activos,
      u.nombre doctor,s.nombre servicio,co.nombre consultorio,co.marca_nombre,co.telefono
    FROM citas c
    JOIN pacientes p ON p.id=c.paciente_id AND p.consultorio_id=c.consultorio_id
    JOIN usuarios u ON u.id=c.doctor_id AND u.consultorio_id=c.consultorio_id
    JOIN servicios s ON s.id=c.servicio_id AND s.consultorio_id=c.consultorio_id
    JOIN consultorios co ON co.id=c.consultorio_id
    WHERE c.id=? AND c.eliminado_en IS NULL`).get(appointmentId);
  if (!appointment?.email || !appointment.recordatorios_activos) return false;

  const date = new Intl.DateTimeFormat('es-BO', {
    timeZone: 'America/La_Paz', dateStyle: 'full', timeStyle: 'short'
  }).format(new Date(appointment.inicio));
  const endTime = new Intl.DateTimeFormat('es-BO', {
    timeZone: 'America/La_Paz', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(appointment.fin));
  const reprogrammed = type === 'reprogramacion';
  const brand = appointment.marca_nombre || appointment.consultorio;
  const heading = reprogrammed ? 'Tu cita fue reprogramada' : 'Tu cita está confirmada';
  const phone = appointment.telefono ? `\nTeléfono de la clínica: ${appointment.telefono}` : '';
  const priceLine = appointment.precio_bs === null
    ? '\nPrecio: se define en la consulta'
    : `\nPrecio: Bs ${new Intl.NumberFormat('es-BO', { maximumFractionDigits: 2 }).format(appointment.precio_bs)}`;
  return sendEmail({
    to: appointment.email,
    subject: `${reprogrammed ? 'Cita reprogramada' : 'Confirmación de cita'} - ${brand}`,
    text: `${brand}\n\nHola ${appointment.nombres},\n\n${heading}.\nServicio: ${appointment.servicio}\nDoctor: ${appointment.doctor}\nFecha y hora: ${date} hasta ${endTime}${phone}${priceLine}\n\nTe esperamos en ${appointment.consultorio}.`
  });
}
