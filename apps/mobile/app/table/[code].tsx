import { RequireSession } from '../../src/screens/RequireSession';
import { WaitingRoomScreen } from '../../src/screens/WaitingRoomScreen';

export default function TableRoute() {
  return (
    <RequireSession>
      <WaitingRoomScreen />
    </RequireSession>
  );
}
