import { config } from './config.js';

const TIME_ZONE = 'America/La_Paz';

export function clinicLogoUrl(clinic) {
  if (!clinic?.logo_path || !clinic?.slug) return null;
  return `${config.clientUrl}/api/publico/clinicas/${clinic.slug}/logo?v=${encodeURIComponent(clinic.logo_path)}`;
}

export function clinicBrand(clinic) {
  return {
    name: clinic?.marca_nombre || clinic?.nombre || 'PORTAL CLÍNICO',
    primary: clinic?.color_primario || '#24577a',
    accent: clinic?.color_acento || '#6672bd',
    background: clinic?.color_fondo || '#f3fafc'
  };
}

function formatDate(value, withTime = true) {
  return new Intl.DateTimeFormat('es-BO', {
    timeZone: TIME_ZONE,
    dateStyle: 'full',
    ...(withTime ? { timeStyle: 'short' } : {})
  }).format(new Date(value));
}

function formatTime(value) {
  return new Intl.DateTimeFormat('es-BO', {
    timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(value));
}

function formatPrice(value) {
  if (value === null || value === undefined) return 'Se define en la consulta';
  return `Bs ${new Intl.NumberFormat('es-BO', { maximumFractionDigits: 2 }).format(value)}`;
}

function shell({ brand, clinic, body }) {
  const logo = clinicLogoUrl(clinic);
  const logoBlock = logo
    ? `<img src="${logo}" alt="${brand.name}" style="max-height:64px;max-width:220px;display:block;margin:0 auto 12px auto;" />`
    : `<div style="font-size:20px;font-weight:700;color:${brand.primary};text-align:center;margin:0 0 12px 0;">${brand.name}</div>`;
  const sloganBlock = clinic?.eslogan
    ? `<div style="text-align:center;color:#ffffff;font-size:11px;letter-spacing:.5px;margin-top:5px;opacity:.85;">${clinic.eslogan}</div>`
    : '';
  const socialLinks = [['Facebook', clinic?.facebook], ['Instagram', clinic?.instagram]].filter(([, value]) => value)
    .map(([label, value]) => `<a href="${value}" style="color:#607d8b;text-decoration:underline;margin:0 6px;">${label}</a>`).join('');
  const whatsappLink = clinic?.whatsapp
    ? `<a href="https://wa.me/${String(clinic.whatsapp).replace(/[^0-9]/g, '')}" style="color:#607d8b;text-decoration:underline;margin:0 6px;">WhatsApp</a>`
    : '';
  const mapsLink = clinic?.ubicacion
    ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clinic.ubicacion)}" style="color:#607d8b;text-decoration:underline;margin:0 6px;">Cómo llegar</a>`
    : '';
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:${brand.background};font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${brand.background};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="background:${brand.primary};padding:22px 24px;">
            ${logoBlock}
            <div style="text-align:center;color:#ffffff;font-size:13px;letter-spacing:1px;">${brand.name.toUpperCase()}</div>
            ${sloganBlock}
          </td>
        </tr>
        <tr><td style="padding:28px 24px;color:#263238;font-size:15px;line-height:1.55;">${body}</td></tr>
        <tr>
          <td style="background:#f4f7f9;padding:16px 24px;text-align:center;color:#607d8b;font-size:12px;line-height:1.5;">
            ${brand.name}<br />
            ${clinic?.telefono ? `Teléfono: ${clinic.telefono}<br />` : ''}${socialLinks || whatsappLink || mapsLink ? `<div style="margin-top:4px;">${socialLinks}${whatsappLink}${mapsLink}</div>` : ''}Tecnología de CopaApp · ${config.clientUrl}
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function appointmentBody({ appointment, heading, lines }) {
  const list = lines.map((line) => `<li style="margin:4px 0;">${line}</li>`).join('\n');
  return `<h2 style="margin:0 0 14px 0;color:${appointment.primary || '#24577a'};font-size:20px;">${heading}</h2>
<p style="margin:0 0 12px 0;">Hola <strong>${appointment.paciente}</strong>,</p>
<ul style="margin:0 0 12px 0;padding-left:20px;color:#37474f;">
${list}
</ul>
<p style="margin:0 0 4px 0;">Te esperamos en <strong>${appointment.consultorio}</strong>.</p>`;
}

export function buildAppointmentMail(appointment, type) {
  const brand = clinicBrand(appointment);
  const primary = appointment.color_primario || brand.primary;
  const accent = appointment.color_acento || brand.accent;
  const date = formatDate(appointment.inicio);
  const endTime = formatTime(appointment.fin);
  const reprogrammed = type === 'reprogramacion';
  const heading = reprogrammed ? 'Tu cita fue reprogramada' : 'Tu cita está confirmada';
  const lines = [
    `Servicio: ${appointment.servicio}`,
    `Doctor: ${appointment.doctor}`,
    `Fecha y hora: ${date} hasta ${endTime}`,
    `Precio: ${formatPrice(appointment.precio_bs)}`
  ];
  const html = shell({
    brand,
    clinic: appointment,
    body: appointmentBody({ appointment: { ...appointment, primary, accent }, heading, lines })
  });
  const text = `${brand.name}\n\nHola ${appointment.paciente},\n\n${heading}.\n${lines.map((line) => `- ${line}`).join('\n')}\n\nTe esperamos en ${appointment.consultorio}.`;
  return {
    subject: `${reprogrammed ? 'Cita reprogramada' : 'Confirmación de cita'} - ${brand.name}`,
    html,
    text
  };
}

export function buildReminderMail(appointment) {
  const brand = clinicBrand(appointment);
  const primary = appointment.color_primario || brand.primary;
  const accent = appointment.color_acento || brand.accent;
  const date = formatDate(appointment.inicio);
  const lines = [
    `Servicio: ${appointment.servicio}`,
    `Fecha y hora: ${date}`,
    `Precio: ${formatPrice(appointment.precio_bs)}`,
    `Consultorio: ${appointment.consultorio}`
  ];
  const html = shell({
    brand,
    clinic: appointment,
    body: appointmentBody({
      appointment: { ...appointment, primary, accent, paciente: appointment.paciente },
      heading: 'Recordatorio de tu cita',
      lines
    })
  });
  const text = `${brand.name}\n\nHola ${appointment.paciente}, le recordamos su cita.\n${lines.map((line) => `- ${line}`).join('\n')}`;
  return {
    subject: `Recordatorio de cita - ${brand.name}`,
    html,
    text
  };
}

export function buildSimpleMail({ clinic, patientName, subject, heading, lines, actionUrl, actionLabel, secondaryUrl, secondaryLabel }) {
  const brand = clinicBrand(clinic);
  const actionButtons = `${actionUrl ? `<p style="margin:0;"><a href="${actionUrl}" style="background:${brand.accent};color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block;font-weight:bold;">${actionLabel || 'Abrir'}</a>` : ''}${secondaryUrl ? ` <a href="${secondaryUrl}" style="color:${brand.accent};text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block;font-weight:bold;border:1px solid ${brand.accent};">${secondaryLabel || 'Abrir'}</a>` : ''}${actionUrl || secondaryUrl ? '</p>' : ''}`;
  const body = `<h2 style="margin:0 0 14px 0;color:${brand.primary};font-size:20px;">${heading}</h2>
<p style="margin:0 0 12px 0;">Hola ${patientName},</p>
<ul style="margin:0 0 12px 0;padding-left:20px;color:#37474f;">
${lines.map((line) => `<li style="margin:4px 0;">${line}</li>`).join('\n')}
</ul>${actionButtons}`;
  const html = shell({ brand, clinic, body });
  const text = `${brand.name}\n\nHola ${patientName},\n\n${heading}.\n${lines.map((line) => `- ${line}`).join('\n')}${actionUrl ? `\n\n${actionLabel || 'Abrir'}: ${actionUrl}` : ''}${secondaryUrl ? `\n${secondaryLabel || 'Abrir'}: ${secondaryUrl}` : ''}`;
  return { subject, html, text };
}

export function buildQuoteMail({ clinic, patientName, subject, heading, items, resumen, pago, quoteUrl, created }) {
  const brand = clinicBrand(clinic);
  const rows = items.map((item) => {
    const quantity = item.cantidad > 1 ? ` ×${item.cantidad}` : '';
    const parts = (item.detalle || []).map((part) => `
      <tr>
        <td style="padding:3px 0 3px 22px;color:#607d8b;font-size:13px;border:0;">· ${part.nombre}</td>
        <td style="padding:3px 0 3px 10px;color:#607d8b;font-size:13px;text-align:right;border:0;white-space:nowrap;">${formatPrice(part.precio_bs)}</td>
      </tr>`).join('');
    const lineTotal = item.precio_bs === null && !(item.detalle || []).length
      ? 'Se define en la consulta'
      : formatPrice((item.precio_bs ?? 0) * item.cantidad + (item.detalle || []).reduce((sum, part) => sum + part.precio_bs, 0));
    return `<tr style="border-top:1px solid #eceff1;">
      <td style="padding:9px 0 3px 0;"><strong>${item.nombre}</strong><span style="color:#90a4ae;font-weight:normal;">${quantity}</span></td>
      <td style="padding:9px 0 3px 10px;text-align:right;white-space:nowrap;"><strong>${lineTotal}</strong></td>
    </tr>${parts}`;
  }).join('');
  const totalBlock = `<tr>
    <td style="padding:12px 0 2px 0;border-top:2px solid ${brand.primary};"><strong>Total cotizado</strong></td>
    <td style="padding:12px 0 2px 10px;text-align:right;border-top:2px solid ${brand.primary};"><strong style="font-size:19px;color:${brand.primary};">${formatPrice(resumen.total_bs)}</strong></td>
  </tr>${pago?.pagado_bs > 0 ? `
  <tr>
    <td style="padding:4px 0 2px 0;color:#607d8b;font-size:14px;">Pagado a cuenta</td>
    <td style="padding:4px 0 2px 10px;text-align:right;color:#607d8b;font-size:14px;white-space:nowrap;">${formatPrice(pago.pagado_bs)}</td>
  </tr>
  <tr>
    <td style="padding:4px 0 2px 0;color:#263238;font-size:14px;"><strong>Saldo pendiente</strong></td>
    <td style="padding:4px 0 2px 10px;text-align:right;color:#263238;font-size:14px;white-space:nowrap;"><strong>${formatPrice(pago.saldo_bs)}</strong></td>
  </tr>` : ''}`;
  const sinPrecio = resumen.sin_precio > 0
    ? `<p style="margin:10px 0 0 0;color:#b45309;font-size:13px;">${resumen.sin_precio} servicio(s) sin precio: se definen en la consulta.</p>` : '';
  const body = `<h2 style="margin:0 0 14px 0;color:${brand.primary};font-size:20px;">${heading}</h2>
<p style="margin:0 0 6px 0;">Hola <strong>${patientName}</strong>,</p>
<p style="margin:0 0 14px 0;color:#607d8b;font-size:14px;">${created ? `Elaborado el ${formatDate(created, false)} por ${brand.name}.` : ''} Revisa el detalle de tu plan de tratamiento:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;color:#263238;font-size:14px;line-height:1.4;">
${rows}
${totalBlock}
</table>
${sinPrecio}
${quoteUrl ? `<p style="margin:18px 0 0 0;"><a href="${quoteUrl}" style="background:${brand.accent};color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block;font-weight:bold;">Ver mi cotización</a></p>` : ''}`;
  const html = shell({ brand, clinic, body });
  const lines = items.map((item) => {
    const detailLine = (item.detalle || []).map((part) => `${part.nombre}: ${formatPrice(part.precio_bs)}`).join(', ');
    return `- ${item.nombre}${item.cantidad > 1 ? ` x${item.cantidad}` : ''}${detailLine ? ` (${detailLine})` : ''}`;
  });
  const text = `${brand.name}\n\nHola ${patientName},\n\n${heading}.\n\n${lines.join('\n')}\n\nTotal cotizado: ${formatPrice(resumen.total_bs)}${pago?.pagado_bs > 0 ? `\nPagado a cuenta: ${formatPrice(pago.pagado_bs)}\nSaldo pendiente: ${formatPrice(pago.saldo_bs)}` : ''}${quoteUrl ? `\n\nVer mi cotización: ${quoteUrl}` : ''}`;
  return { subject, html, text };
}