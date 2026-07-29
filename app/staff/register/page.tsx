import Link from "next/link";

export default function StaffRegisterPage() {
  return <main className="loginShell">
    <div className="loginCard">
      <span className="loginMark">R</span>
      <h1>Реєстрація персоналу</h1>
      <p>Самостійну реєстрацію вимкнено. Облікові записи створює адміністратор і одразу призначає мінімально необхідну роль.</p>
      <Link className="loginPrimaryLink" href="/staff/login">Перейти до входу</Link>
      <Link className="loginBack" href="/">← На головну</Link>
    </div>
  </main>;
}
