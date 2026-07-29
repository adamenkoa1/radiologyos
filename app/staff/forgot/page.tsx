import Link from "next/link";

export default function StaffForgotPage() {
  return <main className="loginShell">
    <div className="loginCard">
      <span className="loginMark">R</span>
      <h1>Відновлення пароля</h1>
      <p>З міркувань безпеки пароль більше не скидається спільним кодом. Зверніться до адміністратора RadiologyOS — він встановить тимчасовий пароль і завершить активні сесії.</p>
      <Link className="loginPrimaryLink" href="/staff/login">Повернутися до входу</Link>
      <Link className="loginBack" href="/">← На головну</Link>
    </div>
  </main>;
}
