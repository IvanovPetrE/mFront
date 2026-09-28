import { AuthProvider } from "./auth/AuthContext";
import { RequireAuth } from "./auth/RequireAuth";
import { ChatsPage } from "./pages/ChatsPage";

export default function App() {
  return (
    <AuthProvider>
      <RequireAuth>
        <ChatsPage />
      </RequireAuth>
    </AuthProvider>
  );
}
