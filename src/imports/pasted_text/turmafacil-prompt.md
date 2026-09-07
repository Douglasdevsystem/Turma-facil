# Nome sugerido: **TurmaFácil**

*(app de gestão de turmas, chamada e notas para professores)*

**Outras opções de nome**, caso prefira: DiárioPro · ChamaTurma · ProfGestor · Classe+

Escolhi **TurmaFácil** porque comunica direto o benefício central do sistema — tirar do professor o trabalho manual de montar turma, fazer chamada e lançar nota (hoje feito em papel, como no seu "Diário de Classe" da EETEPA) e tornar isso rápido e digital.

---

## Como usar

Copie todo o bloco abaixo (a partir de "PROMPT PARA O FIGMA MAKE") e cole na caixa de prompt do Figma Make. Ele já está estruturado em telas, fluxos e componentes para gerar um protótipo navegável completo.

---

## PROMPT PARA O FIGMA MAKE

```
Crie um aplicativo web (mobile-first, responsivo) chamado "TurmaFácil", um sistema
de apoio para professores gerenciarem turmas, chamada e notas escolares.

CONTEXTO DE USO
O professor hoje preenche manualmente um "Diário de Classe" em papel/PDF, com:
escola, turno, turma, disciplina, ano/bimestre, lista numerada de alunos, colunas
de presença por dia (P/F) e colunas de notas (Atividade Classe, Atividade Extra,
Prova, Outros, Resumo do Bimestre, Recuperação). O app deve digitalizar esse
fluxo inteiro.

IDENTIDADE VISUAL
- Paleta principal em azul/verde (transmitindo confiança e organização escolar),
  com bom contraste para uso em sala de aula.
- Tipografia limpa e legível, cantos arredondados, cards com sombra leve.
- Ícones de: turma (pessoas), chamada (check), notas (gráfico/nota), escola
  (prédio), perfil (usuário).
- Layout pensado para uso rápido: professor usa entre aulas, precisa de poucos
  toques para concluir tarefas.

=====================================================
TELA 1 — AUTENTICAÇÃO (Login / Cadastro)
=====================================================
- Tela de Login: campos de e-mail e senha, botão "Entrar", link "Esqueci minha
  senha" e link "Criar conta".
- Tela de Cadastro: nome completo, e-mail, senha, confirmar senha, disciplina(s)
  que leciona (multi-seleção), botão "Cadastrar".
- Validação visual dos campos (erro em vermelho, sucesso em verde).
- Opção de login social (Google) como botão secundário.

=====================================================
TELA 2 — HOME (Painel do Professor)
=====================================================
- Saudação personalizada ("Olá, [Nome do Professor]").
- Cards de resumo no topo: nº de turmas ativas, chamadas feitas na semana,
  notas pendentes de lançamento.
- Lista de "Minhas Turmas" em cards (nome da turma, escola, turno, nº de alunos),
  cada card com atalhos rápidos: "Fazer chamada" e "Lançar notas".
- Botão flutuante (+) para "Criar nova turma".
- Barra de navegação inferior fixa com 4 ícones: Home, Turmas, Escolas, Perfil.

=====================================================
TELA 3 — CRIAR TURMA (fluxo em etapas / wizard)
=====================================================
Etapa 1 — Dados da turma:
  - Nome da turma (ex: "Zootecnia 2024")
  - Escola (selecionar de lista já cadastrada ou "+ Nova escola")
  - Turno (Manhã / Tarde / Noite) — seleção tipo chips
  - Ano/Série ou Fase (ex: "5ª Fase", "3º Ano")
  - Disciplina
  - Ano letivo (ex: 2026) e Bimestre

Etapa 2 — Importar alunos:
  - Área de upload (drag-and-drop) com duas opções em abas: "Importar PDF" e
    "Importar Excel/CSV"
  - Texto de apoio: "Envie a lista de alunos (ex: diário de classe em PDF) e o
    sistema identifica os nomes automaticamente"
  - Após upload, mostrar estado de carregamento ("Lendo documento...")
  - Tela de revisão: lista de nomes extraídos, numerada, com opção de editar,
    excluir ou adicionar aluno manualmente antes de confirmar
  - Botão "Adicionar aluno manualmente" (nome + nº de matrícula opcional)

Etapa 3 — Confirmação:
  - Resumo da turma criada (todos os dados + total de alunos)
  - Botão "Criar turma" (finaliza) e "Voltar para editar"

=====================================================
TELA 4 — TURMAS (lista e detalhe)
=====================================================
- Lista de turmas com busca e filtros (por escola, turno, ano letivo)
- Ao abrir uma turma, mostrar 3 abas internas:
  1. "Alunos" — lista numerada com foto/avatar padrão, nome, status
  2. "Chamada" — atalho para nova chamada + histórico de chamadas
  3. "Notas" — tabela de lançamento de notas
- Menu de opções da turma (editar dados, importar mais alunos, arquivar turma)

=====================================================
TELA 5 — FAZER CHAMADA
=====================================================
- Cabeçalho com nome da turma, data (padrão: hoje, editável) e disciplina
- Lista de alunos numerada com toggle de presença por aluno: Presente / Falta /
  Falta Justificada (3 estados, cores verde/vermelho/amarelo)
- Botão "Marcar todos presentes" no topo (atalho)
- Contador ao vivo: "24 presentes · 2 faltas"
- Botão "Salvar chamada" fixo no rodapé

=====================================================
TELA 6 — HISTÓRICO DE CHAMADAS
=====================================================
- Lista de chamadas já realizadas por turma, organizadas por data (mais recente
  primeiro)
- Cada item mostra: data, nº de presentes/faltas, ícone de status
- Ao clicar, abre o detalhe da chamada daquele dia (lista completa de alunos e
  presença marcada), com opção de editar
- Filtro por período (mês/bimestre) e exportar (PDF/Excel)

=====================================================
TELA 7 — LANÇAR NOTAS
=====================================================
- Seleção de turma, disciplina e bimestre no topo
- Tabela com colunas editáveis inline, espelhando o diário de classe físico:
  Nº | Aluno | Atividade em Classe | Atividade Extra | Prova | Outros |
  Média do Bimestre (calculado automaticamente) | Recuperação
- Campos numéricos com teclado numérico no mobile
- Cálculo automático da média/resumo do bimestre conforme valores preenchidos
- Botão "Salvar notas" fixo no rodapé
- Indicador visual de aluno com média abaixo da nota mínima (destaque em
  vermelho/laranja)

=====================================================
TELA 8 — ESCOLAS
=====================================================
- Lista de escolas cadastradas pelo professor (nome, cidade/UF)
- Botão "+ Adicionar escola" com formulário: nome da escola, cidade, estado,
  rede (Estadual/Municipal/Privada)
- Ao abrir uma escola, mostrar as turmas vinculadas a ela

=====================================================
TELA 9 — PERFIL
=====================================================
- Foto/avatar, nome, e-mail, disciplinas que leciona
- Opção de editar dados pessoais e trocar senha
- Seção "Minhas escolas" e "Minhas turmas" (atalhos)
- Preferências: notificações, tema claro/escuro
- Botão "Sair da conta"

=====================================================
FUNCIONALIDADES-CHAVE A DESTACAR NO PROTÓTIPO
=====================================================
1. Importação inteligente de PDF/Excel na criação da turma, com etapa de
   revisão humana antes de confirmar (o sistema lê, mas o professor valida).
2. Chamada rápida (poucos toques, contador ao vivo, "marcar todos presentes").
3. Histórico de chamadas consultável e editável por data.
4. Lançamento de notas em formato de tabela/planilha, com cálculo automático
   de médias, espelhando o modelo de diário de classe que o professor já
   conhece do papel.
5. Organização hierárquica clara: Escola > Turma > Alunos, refletida na
   navegação.

Gere o protótipo com navegação clicável entre todas as telas descritas acima,
usando dados de exemplo realistas (nomes de alunos, escolas e turmas fictícias
em português).
```

---

### Observação sobre a leitura automática do PDF/Excel

O prompt acima já descreve a *interface* dessa função (tela de upload → revisão → confirmação). A extração de texto do PDF em si (OCR/parsing de nomes) é lógica de backend — o Figma Make vai gerar a tela e o fluxo visual, mas a implementação real da leitura do arquivo precisa ser feita depois, em código (por exemplo com Claude Code), usando a estrutura de colunas que vi no seu diário de classe como referência (Nº, Aluno, colunas de presença e notas).

Quer que eu já monte esse parser de PDF/Excel em código também?