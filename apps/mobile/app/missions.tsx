import { MissionsScreen } from '../src/screens/MissionsScreen';
import { RequireSession } from '../src/screens/RequireSession';

export default function Missions() {
  return (
    <RequireSession>
      <MissionsScreen />
    </RequireSession>
  );
}
