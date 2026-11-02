import { HomeScreen } from '../src/screens/HomeScreen';
import { RequireSession } from '../src/screens/RequireSession';

export default function Home() {
  return (
    <RequireSession>
      <HomeScreen />
    </RequireSession>
  );
}
