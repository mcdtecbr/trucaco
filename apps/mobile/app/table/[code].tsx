import { RequireSession } from '../../src/screens/RequireSession';
import { TableRoomScreen } from '../../src/screens/TableRoomScreen';

export default function TableRoute() {
  return (
    <RequireSession>
      <TableRoomScreen />
    </RequireSession>
  );
}
