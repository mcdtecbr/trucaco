// Metro para o monorepo pnpm. O `expo/metro-config` (SDK 58) já detecta a raiz do workspace
// (watchFolders), resolve node_modules da raiz e do app e habilita `package.json#exports`.
// Os pacotes @trucaco/* são resolvidos pelo `exports` -> `dist/` (por isso `pnpm build` antes
// do `expo start`/`export`; o turbo faz isso via `dependsOn: ^build`).
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// `ws` (puxado por `@colyseus/sdk`) não empacota no Metro nativo: ver shims/ws-stub.js.
const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'ws') {
    return { type: 'sourceFile', filePath: path.join(__dirname, 'shims', 'ws-stub.js') };
  }
  return (upstreamResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
