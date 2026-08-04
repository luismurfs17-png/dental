export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export function required(body, fields) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === null || body[field] === '');
  if (missing.length) throw new ApiError(400, `Faltan campos obligatorios: ${missing.join(', ')}`);
}

export function positiveNumber(value, name = 'valor') {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new ApiError(400, `${name} debe ser un número mayor que cero`);
  return number;
}
