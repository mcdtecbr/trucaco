// `@colyseus/sdk` importa `ws` como reserva para Node (`globalThis.WebSocket || NodeWebSocket`).
// O Metro nativo não tem os módulos de core do Node (stream, http, ...), então `ws` é trocado por
// este stub. Em web e React Native `globalThis.WebSocket` existe e o stub nunca é instanciado.
module.exports = class UnavailableNodeWebSocket {
  constructor() {
    throw new Error('ws indisponível neste ambiente: use o WebSocket global');
  }
};
