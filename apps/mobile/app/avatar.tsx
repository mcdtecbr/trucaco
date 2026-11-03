import { AvatarEditorScreen } from '../src/screens/AvatarEditorScreen';
import { RequireSession } from '../src/screens/RequireSession';

export default function AvatarRoute() {
  return (
    <RequireSession>
      <AvatarEditorScreen />
    </RequireSession>
  );
}
