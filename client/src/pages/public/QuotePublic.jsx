import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, formatDate, formatMoney } from '../../lib/api.js'
import { clinicBrand, clinicTheme } from '../../lib/branding.js'
import Icon from '../../components/Icon.jsx'
import { ErrorState, Loading, StatusPill } from '../../components/UI.jsx'

function QuoteItem({ item }) {
  const extras = item.detalle || []
  const lineTotal = item.total_bs === null || item.total_bs === undefined
    ? (extras.length ? formatMoney(extras.reduce((sum, part) => sum + part.precio_bs, 0)) : 'A definir')
    : formatMoney(item.total_bs)
  return (
    <article className="quote-item">
      <div className="quote-item-name"><strong>{item.nombre}</strong>{item.notas && <small>{item.notas}</small>}
        {extras.length > 0 && (
          <small className="quote-item-parts">
            {extras.map((part, index) => (
              <span key={index}>{part.nombre} · {formatMoney(part.precio_bs)}</span>
            ))}
          </small>
        )}
      </div>
      <span className="quote-item-qty">{item.cantidad > 1 ? `×${item.cantidad}` : ''}{item.duracion_min ? <small>&nbsp;· {item.duracion_min} min</small> : null}</span>
      <strong>{lineTotal}</strong>
    </article>
  )
}

export default function QuotePublic() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    api(`/presupuestos/publico/${token}`)
      .then((response) => { if (active) setData(response) })
      .catch((requestError) => { if (active) setError(requestError.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token])

  return (
    <div className="quote-public-page" style={clinicTheme(data?.consultorio)}>
      <header className="quote-public-head">
        <div className="brand-public"><span className={`brand-mark ${data?.consultorio?.logo_url ? 'has-logo' : ''}`}>{data?.consultorio?.logo_url ? <img src={data.consultorio.logo_url} alt="" /> : <Icon name="tooth" size={22} />}</span><span>{clinicBrand(data?.consultorio).name}</span></div>
        <h1>Cotización de tratamiento</h1>
      </header>
      <main className="quote-public-card">
        {loading ? (
          <Loading label="Abriendo tu cotización" />
        ) : error ? (
          <ErrorState message={error} />
        ) : data ? (
          <>
            <div className="quote-public-patient">
              <div className="modal-avatar">{`${data.paciente.nombres} ${data.paciente.apellidos}`.trim().slice(0, 1)}</div>
              <div>
                <h2>{data.paciente.nombres} {data.paciente.apellidos}</h2>
                <small>{data.paciente.codigo}</small>
              </div>
              <StatusPill status={data.cotizacion.estado} />
            </div>
            <div className="quote-public-body">
              <h3>{data.cotizacion.titulo || 'Plan de tratamiento'}</h3>
              <p className="muted-box">
                Elaborado el {formatDate(data.cotizacion.creado_en)} por {data.consultorio.nombre}
              </p>
              <div className="quote-items readonly">
                {data.cotizacion.items.map((item, index) => (
                  <QuoteItem key={`${item.nombre}-${index}`} item={item} />
                ))}
              </div>
              <div className="quote-totals">
                <div><small>Total cotizado</small><strong>{formatMoney(data.cotizacion.total_bs)}</strong></div>
                {data.cotizacion.pago?.pagado_bs > 0 && <div><small>Pagado a cuenta</small><strong>{formatMoney(data.cotizacion.pago.pagado_bs)}</strong></div>}
                {data.cotizacion.pago?.saldo_bs > 0 && <div><small>Saldo pendiente</small><strong>{formatMoney(data.cotizacion.pago.saldo_bs)}</strong></div>}
                {data.cotizacion.pago?.estado === 'pagado' && <p>Esta cotización está totalmente pagada.</p>}
                {data.cotizacion.sin_precio > 0 && <p>{data.cotizacion.sin_precio} servicio(s) sin precio · se definen en consulta</p>}
              </div>
              {data.cotizacion.notas && <p className="quote-notes">{data.cotizacion.notas}</p>}
            </div>
            {data.consultorio.telefono && (
              <footer className="quote-public-foot">
                <Icon name="phone" size={15} /> Consultas al {data.consultorio.telefono}
              </footer>
            )}
          </>
        ) : null}
      </main>
      <p className="quote-public-hint">Solo esta cotización es visible con este enlace.</p>
    </div>
  )
}
