import { LoginForm } from "../components/LoginForm.js";

export default function LoginPage() {
  return (
    <main className="login-shell">
      <header className="hero">
        <p className="brand">PROVIDE</p>
        <p className="eyebrow">Geschützter Personalzugang</p>
        <h1>Restaurant-Dashboard anmelden</h1>
        <p>Verwende ausschließlich dein persönliches, vom Restaurant freigegebenes Konto.</p>
      </header>
      <section className="panel" aria-label="Anmeldung">
        <LoginForm enabled={process.env.DASHBOARD_AUTH_ENABLED === "true"} />
      </section>
    </main>
  );
}
