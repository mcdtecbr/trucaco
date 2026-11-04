import { ProfileScreen } from '../src/screens/ProfileScreen';
import { RequireSession } from '../src/screens/RequireSession';

export default function Profile() {
  return (
    <RequireSession>
      <ProfileScreen />
    </RequireSession>
  );
}
