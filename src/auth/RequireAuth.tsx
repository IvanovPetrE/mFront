import type { ReactNode } from "react";
import { useAuth } from "./AuthContext";
import { LoginPage } from "../pages/LoginPage";
import { IconAlert, IconLock } from "../components/icons";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, error, retry, logout } = useAuth();

  if (status === "loading") {
    return (
      <main className="screen screen-plain" role="status">
        <span className="spinner spinner-lg" aria-hidden="true" />
        <span className="sr-only">Загрузка…</span>
      </main>
    );
  }
  if (status === "error") {
    return (
      <main className="screen">
        <div className="screen-card" role="alert">
          <div className="screen-logo danger" aria-hidden="true">
            <IconAlert size={32} />
          </div>
          <h1>Не удалось подключиться</h1>
          <p>{error}</p>
          <button className="btn btn-primary btn-block" onClick={retry}>
            Повторить
          </button>
        </div>
      </main>
    );
  }
  if (status === "disabled") {
    return (
      <main className="screen">
        <div className="screen-card" role="alert">
          <div className="screen-logo danger" aria-hidden="true">
            <IconLock size={30} />
          </div>
          <h1>Аккаунт отключён</h1>
          <p>Вход выполнен, но доступ к мессенджеру для этой учётной записи закрыт. Обратитесь к администратору.</p>
          <button className="btn btn-secondary btn-block" onClick={logout}>
            Выйти и войти под другим аккаунтом
          </button>
        </div>
      </main>
    );
  }
  if (status === "anonymous") {
    return <LoginPage />;
  }
  return <>{children}</>;
}
