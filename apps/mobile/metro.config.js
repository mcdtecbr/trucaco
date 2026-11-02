// Metro para o monorepo pnpm. O `expo/metro-config` (SDK 58) já detecta a raiz do workspace
// (watchFolders), resolve node_modules da raiz e do app e habilita `package.json#exports`.
// Os pacotes @trucaco/* são resolvidos pelo `exports` -> `dist/` (por isso `pnpm build` antes
// do `expo start`/`export`; o turbo faz isso via `dependsOn: ^build`).
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
