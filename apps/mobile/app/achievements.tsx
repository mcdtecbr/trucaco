import { AchievementsScreen } from '../src/screens/AchievementsScreen';
import { RequireSession } from '../src/screens/RequireSession';

export default function Achievements() {
  return (
    <RequireSession>
      <AchievementsScreen />
    </RequireSession>
  );
}
