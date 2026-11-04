import { PublicProfileScreen } from '../../src/screens/PublicProfileScreen';
import { RequireSession } from '../../src/screens/RequireSession';

export default function PublicProfile() {
  return (
    <RequireSession>
      <PublicProfileScreen />
    </RequireSession>
  );
}
