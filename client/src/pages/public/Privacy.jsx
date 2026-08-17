import { Link } from 'react-router-dom'
import Icon from '../../components/Icon.jsx'

export default function Privacy() {
  return (
    <div className="privacy-page">
      <div className="privacy-card">
        <header className="privacy-head">
          <span className="brand-mark"><Icon name="tooth" size={24} /></span>
          <div>
            <h1>Política de privacidad</h1>
            <p>Sonrident · Portal Clínico</p>
          </div>
        </header>
        <section>
          <h2>1. Datos que tratamos</h2>
          <p>La plataforma guarda los datos que tu consultorio registra: pacientes, citas, historia clínica, cotizaciones y pagos, además de tu correo y nombre de usuario para el acceso.</p>
        </section>
        <section>
          <h2>2. Uso de los datos</h2>
          <p>Los datos se usan exclusivamente para operar tu consultorio digital: agendar citas, enviar confirmaciones y recordatorios por correo, registrar pagos y conservar la historia clínica. No se venden ni se comparten con terceros.</p>
        </section>
        <section>
          <h2>3. Correos automáticos</h2>
          <p>Los avisos (confirmaciones, recordatorios y cotizaciones) se envían solo a los correos registrados en tu consultorio. Puedes desactivar los recordatorios por paciente en cualquier momento.</p>
        </section>
        <section>
          <h2>4. Almacenamiento y seguridad</h2>
          <p>La información se almacena de forma cifrada en servidores seguros, con respaldos automáticos diarios y copias por consultorio. Cada clínica mantiene sus datos aislados del resto.</p>
        </section>
        <section>
          <h2>5. Tus derechos</h2>
          <p>Puedes solicitar la corrección o eliminación de tus datos a tu consultorio, que es el responsable del tratamiento de la información registrada en la plataforma.</p>
        </section>
        <footer className="privacy-foot">
          <Link to="/login">Volver al acceso</Link>
          <span>Última actualización: agosto de 2026</span>
        </footer>
      </div>
    </div>
  )
}