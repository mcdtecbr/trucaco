import { RequireSession } from '../src/screens/RequireSession';
import { SettingsScreen } from '../src/screens/SettingsScreen';

export default function Settings() {
  return (
    <RequireSession>
      <SettingsScreen />
    </RequireSession>
  );
}
