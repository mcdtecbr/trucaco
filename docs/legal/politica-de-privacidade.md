**RASCUNHO, revisar antes de publicar.** Este texto não vale como documento final: falta a revisão jurídica e todas as lacunas marcadas com [A DEFINIR] precisam ser preenchidas. Remova este aviso antes de publicar.

# Política de Privacidade

Última atualização: [A DEFINIR: data de publicação].

Esta política explica quais dados pessoais o Trucaço trata, para que, por quanto tempo e quais são os seus direitos, de acordo com a Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018). Ela faz parte dos Termos de uso.

## 1. Resumo

- Guardamos só o necessário para jogar: um apelido e, se quiser, um avatar.
- Não guardamos e-mail, nome, telefone, endereço, localização, contatos, câmera nem microfone. Não usamos a câmera nem o microfone do aparelho.
- Não usamos anúncios nem rastreadores, e não vendemos dados.
- O texto do chat não é guardado.
- Você pode apagar a sua conta a qualquer momento, e os efeitos estão descritos na seção 8.

## 2. Quem é responsável pelos dados

- Controlador: [A DEFINIR: razão social e CNPJ de quem opera o Trucaço].
- Encarregado pelo tratamento de dados e canal para titulares: [A DEFINIR: nome e e-mail].

## 3. Quais dados tratamos

### Conta

- Um identificador interno aleatório. Ele não é CPF, e-mail nem telefone.
- O tipo de conta: convidado, Google ou Apple.
- Nas contas Google ou Apple, o identificador que o provedor usa para a sua conta. O e-mail e o nome que o provedor informa não são guardados.
- O apelido.
- O avatar: as partes escolhidas no criador. Não há foto.
- As datas de criação, de vínculo com o provedor e da última renovação de sessão.

### Partidas e progresso

- As partidas: mesa privada ou pública, variante, formato, pontuação de cada jogo, eventos da mesa (apostas, vazas e cartas jogadas, que são visíveis a todos), o jogador em cada posição e se houve bot no lugar dele.
- As cartas distribuídas em cada mão, guardadas por 30 dias só para investigar trapaça.
- As estatísticas: partidas jogadas e vitórias por variante.
- As conquistas e as missões: o progresso e a data em que foram conquistadas.

### Relações entre jogadores

- Os bloqueios que você fez.
- As denúncias: quem denunciou, quem foi denunciado, a partida (se houver), o motivo, o texto opcional (até 500 caracteres) e a situação da denúncia.
- Os combinados de sinais da dupla: o significado que vocês combinaram para cada sinal, até 60 caracteres por sinal. Ficam guardados para o par de parceiros que já terminou uma partida junto.

### Conversas

- O chat da mesa e o chat da dupla não são guardados. O texto só existe para os destinatários enquanto a sala existir.
- Sinais, balões e efeitos sonoros também não são guardados.

### Dados técnicos e de segurança

- O endereço IP é usado só na memória do servidor, para limitar pedidos excessivos. Ele não é gravado no banco de dados nem nos registros do servidor. NOTA PARA REVISÃO: a plataforma de hospedagem pode registrar o IP nos próprios registros de acesso. Confirmar antes de publicar.
- Registros de erro e de operação, sem token, sem texto de chat, sem cartas e sem apelido, com um código de rastreio por requisição.
- Registros de segurança da sessão (por exemplo, reutilização de um token de renovação): podem trazer o identificador interno da sua conta, um código aleatório sem nome nem e-mail. NOTA PARA REVISÃO: o README do servidor diz que o identificador não aparece nos logs; o código registra nesses casos. Alinhar antes de publicar. Prazo de guarda dos registros: [A DEFINIR].
- Métricas agregadas (quantas salas, quantas pessoas na fila, erros por tipo), sem identificar ninguém.
- A sessão: um token de acesso, válido por 15 minutos, e um token de renovação, válido por 30 dias. O token de renovação é guardado só como impressão digital (hash), nunca em texto.

### No seu aparelho

- No navegador: um cookie chamado refresh, com as marcas HttpOnly e SameSite=Strict, enviado só às rotas de autenticação, válido por 30 dias. Ele serve para manter você conectado. Não há outro cookie do jogo.
- No navegador, no armazenamento local: o seu identificador e o seu apelido (para mostrar o jogo ao voltar), as preferências de som e a lista de jogadores silenciados.
- No navegador, na sessão da aba: o código para retomar a mesa depois de recarregar a página. Ele some ao fechar a aba.
- No aplicativo para celular, quando houver: a sessão fica no armazenamento seguro do aparelho. [A DEFINIR: confirmar quando o aplicativo for publicado].

### O que não coletamos hoje

Localização, contatos, câmera, microfone, identificadores para publicidade e dados de pagamento. Compras e anúncios, se houver, seguem os Termos de uso.

## 4. Para que usamos e qual a base legal

- Criar e manter a sua conta e a sua sessão. Base legal: execução de contrato (LGPD, art. 7º, V).
- Montar as mesas, registrar as partidas, mostrar o histórico, as estatísticas e as conquistas. Base legal: execução de contrato (art. 7º, V).
- Impedir trapaça, abuso e spam, limitar pedidos excessivos e investigar denúncias. Base legal: legítimo interesse (art. 7º, IX), com o uso limitado ao necessário para proteger o jogo e os jogadores.
- Obrigação legal: NOTA PARA REVISÃO: o Marco Civil da Internet (art. 15) pode exigir a guarda de registros de acesso por seis meses, o que hoje o Trucaço não faz porque não guarda IP. A revisão jurídica deve decidir se isso se aplica e como atender.
- Estatísticas de uso agregadas, como o número de pessoas que jogaram por dia. Base legal: legítimo interesse, sem identificar ninguém.
- Não usamos seus dados para publicidade nem para formar perfis vendidos a terceiros.

## 5. Com quem compartilhamos

- Hospedagem: o servidor do jogo e o site são hospedados na Fly.io, com região prevista em São Paulo. [A DEFINIR: confirmar a região].
- Banco de dados e Redis: previstos na Fly Postgres e na Upstash. [A DEFINIR: região da Upstash. Se a região estiver fora do Brasil, a transferência internacional segue o art. 33 da LGPD].
- Google e Apple: só quando você entra com a conta deles, sob as políticas de privacidade deles.
- Outros jogadores: veem o seu apelido, o seu avatar, a sua posição na mesa, os sinais e balões que você envia e o chat da mesa. O combinado de sinais só é visto pela sua dupla. O perfil público mostra o apelido, o avatar, as conquistas desbloqueadas e o total de partidas e vitórias por variante. O histórico de partidas é só seu.
- Autoridades: quando houver ordem judicial ou obrigação legal. [A DEFINIR: procedimento de atendimento].
- Não vendemos nem cedemos dados para publicidade.

## 6. Por quanto tempo guardamos

- Cartas distribuídas em cada mão: 30 dias. Depois disso são apagadas.
- Partidas canceladas: 30 dias.
- Partidas terminadas, com seus eventos: 12 meses. Depois disso são apagadas. Ao apagar a sua conta, o seu lugar nelas fica sem identificação.
- Conta de convidado sem uso há 90 dias, que nunca foi vinculada a Google ou Apple e que não tem partida, conquista com progresso nem denúncia aberta contra ela: é apagada.
- Missões de dias ou semanas com mais de 90 dias: apagadas.
- Sessão: 30 dias sem uso. Cada renovação renova esse prazo, mas uma mesma sessão não passa de 90 dias desde o login.
- Denúncias fechadas: 12 meses depois da análise. Denúncias abertas: enquanto não forem analisadas. NOTA PARA REVISÃO: esta regra ainda não está em execução no servidor.
- Combinados de sinais de uma dupla: enquanto as duas contas existirem. [A DEFINIR: prazo de inatividade, proposta de 12 meses; ainda não está em execução].
- Registros de acesso e de operação: [A DEFINIR: prazo, a confirmar com a plataforma de hospedagem e com a revisão jurídica].
- Cópias de segurança (backups): [A DEFINIR: prazo em que os backups são substituídos].

## 7. Seus direitos

Pela LGPD, você pode pedir:

- confirmação de que tratamos seus dados e acesso a eles: no jogo, no Perfil, você vê o seu histórico, as conquistas e as estatísticas;
- correção: o apelido e o avatar podem ser trocados no próprio jogo;
- anonimização, bloqueio ou eliminação de dados desnecessários: a eliminação da conta está na seção 8;
- portabilidade: [A DEFINIR: o jogo ainda não exporta seus dados em arquivo];
- informação sobre com quem compartilhamos: está na seção 5;
- oposição a um tratamento, quando ele for baseado em legítimo interesse: [A DEFINIR: canal];
- revisão de decisões automatizadas: [A DEFINIR, se aplicável].

Como pedir: pelo próprio jogo ou pelo canal da seção 2. [A DEFINIR: prazo de resposta]. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).

## 8. Apagar a sua conta

No jogo, abra Configurações, em Apagar conta, e confirme. A ação não pode ser desfeita.

Ao apagar a conta, são apagados:

- a conta, o apelido e o avatar;
- os bloqueios feitos por você e os feitos contra você;
- os combinados de sinais da sua dupla;
- as conquistas, as missões e as estatísticas;
- as sessões em todos os aparelhos;
- o texto livre que você escreveu nas denúncias. O registro da denúncia permanece, sem o texto.

Continuam guardados, sem identificar você:

- as partidas em que você jogou, com o seu lugar aparecendo como jogador removido;
- as denúncias feitas contra você, como registro de moderação;
- as marcas que impedem contar a mesma partida duas vezes para conquistas.

Os jogadores que estavam numa partida com você passam a ter um bot no seu lugar, sem nenhuma espera. [A DEFINIR: prazo de exclusão dos backups].

## 9. Segurança

- O acesso ao jogo é feito por HTTPS e WSS (conexões criptografadas). A hospedagem está configurada para redirecionar HTTP para HTTPS. NOTA PARA REVISÃO: confirmar no ambiente de produção.
- O Trucaço não tem senha: a sessão é renovada por tokens curtos. Se um token de renovação antigo for reutilizado, a sessão inteira é encerrada.
- O token de renovação fica guardado só como impressão digital.
- Os registros do servidor não contêm tokens, cookies, texto de chat, cartas nem apelidos.
- Há limites de tentativas e de criação de contas por IP.
- NOTA PARA REVISÃO: a separação de credenciais entre migração e execução do banco ainda é pendência de infraestrutura. Confirmar antes de publicar.
- Se ocorrer um incidente que possa causar risco ou dano relevante, comunicaremos a ANPD e as pessoas afetadas, conforme o art. 48 da LGPD. [A DEFINIR: prazo].
- Nenhum sistema é totalmente seguro. Fazemos o possível para proteger os seus dados.

## 10. Crianças e adolescentes

[A DEFINIR: idade mínima e regra de consentimento de responsável, conforme o art. 14 da LGPD e a legislação aplicável].

NOTA PARA REVISÃO: hoje o cadastro não pergunta a idade do jogador.

## 11. Cookies e armazenamento local

O Trucaço usa só o cookie de sessão descrito na seção 3, que é necessário para o jogo funcionar. Não usamos cookies de publicidade nem de medição de audiência. O armazenamento local e a sessão da aba servem às preferências e à retomada da mesa, como descrito na seção 3.

## 12. Alterações desta política

Podemos atualizar esta política. Avisaremos no próprio jogo: [A DEFINIR: prazo de aviso prévio]. A data no topo mostra a versão em vigor.

## 13. Contato

Dúvidas, pedidos e reclamações: [A DEFINIR: e-mail de contato e canal do encarregado].
