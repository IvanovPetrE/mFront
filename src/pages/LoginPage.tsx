import { useAuth } from "../auth/AuthContext";
import { IconChat } from "../components/icons";

export function LoginPage() {
  const { login } = useAuth();
  return (
    <main className="screen">
      <div className="screen-card">
        <div className="screen-logo" aria-hidden="true">
          <IconChat size={32} />
        </div>
        <h1>Мессенджер</h1>
        <p>Общайтесь с коллегами один на один и в группах. Сообщения приходят мгновенно.</p>
        <button className="btn btn-primary btn-block" onClick={login}>
          Войти
        </button>
        <p className="screen-footnote">Вход через единую учётную запись организации (Keycloak)</p>
      </div>
    </main>
  );
}
