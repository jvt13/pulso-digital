# Política de publicação controlada

## Modos

- `manual` — padrão. Exige aprovação humana explícita vinculada ao hash validado.
- `assisted` — prepara e enfileira a matéria para aprovação; não publica.
- `autonomous-controlled` — avaliação simulada, obrigatoriamente sem publicação real nesta
  versão.

## Risco editorial

O risco é classificado por fatores, não apenas por categoria ou nota:

- validação determinística e revisão semântica atuais;
- achados semânticos e severidade;
- evidências completas e independência das fontes;
- rumores, expectativas e declarações atribuídas;
- direitos de imagem;
- Quality Score e cobertura;
- extensão de citações diretas;
- integridade editorial e journal;
- duplicidade e atualidade.

Rumores, evidências insuficientes, direitos incertos, revisão desatualizada ou falha de
integridade exigem intervenção humana.

## Limites

- máximo de três novas matérias por dia;
- intervalo mínimo de 60 minutos entre publicações;
- máximo padrão de uma publicação por categoria por dia;
- janela de atualidade configurável;
- pausa emergencial;
- circuit breaker após falhas sucessivas;
- deduplicação e bloqueio por erro de validação.

## Decisões

Decisões automatizadas são registradas como eventos `publication-policy-evaluation` no SQLite.
Elas são distintas da aprovação humana e nunca preenchem o campo `approval`, assinatura,
reviewer ou receipt de publicação.

O avaliador sempre retorna `publicationAllowed=false` nesta versão. Publicação real continua
exclusivamente no fluxo editorial explícito.

## Autorização isolada

O motor editorial pode criar `policyAuthorization`, distinta de `approval`, somente quando
instanciado explicitamente para ambiente isolado. A autorização registra decisão, hash do
conteúdo, hash do contexto de revisão/evidências/política, risco, direitos, validade e
critérios atendidos. O publisher exige o hash de contexto atual e gera receipt
`authorizationType: policy-automated`.

O ambiente operacional não habilita `allowPolicyAuthorization`; portanto o caminho permanece
restrito à simulação e aos testes.
