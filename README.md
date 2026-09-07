# Turma Fácil Brasil

## Deploy na Vercel

Importe este repositório na Vercel e use as configurações padrão do projeto Vite. O arquivo `vercel.json` já configura o build e o rewrite das rotas do React.

No painel da Vercel, adicione estas variáveis em **Settings > Environment Variables** para Production, Preview e Development:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_DATABASE_URL
```

Os valores estão no arquivo `.env.local` da máquina de desenvolvimento. Não publique esse arquivo no Git.
