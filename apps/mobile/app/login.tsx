import { LoginScreen } from '../src/screens/LoginScreen';
import { RequireSession } from '../src/screens/RequireSession';

export default function Login() {
  return (
    <RequireSession>
      <LoginScreen />
    </RequireSession>
  );
}
