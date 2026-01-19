# Configuração do Render

Este guia mostra como configurar as variáveis de ambiente no Render para o servidor funcionar corretamente.

## ⚠️ Erro Atual

Se você está vendo este erro nos logs:

```
[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable.
```

Significa que a variável `OAUTH_SERVER_URL` não está configurada no Render.

## 🔧 Como Configurar

### Passo 1: Acessar o Render Dashboard

1. Acesse: https://dashboard.render.com
2. Faça login com sua conta
3. Clique no serviço **btc-alerts-server**

### Passo 2: Adicionar Variáveis de Ambiente

1. No menu lateral esquerdo, clique em **Environment**
2. Role até a seção **Environment Variables**
3. Clique no botão **Add Environment Variable**

### Passo 3: Adicionar Variável Obrigatória

**Variável 1: OAUTH_SERVER_URL** (OBRIGATÓRIA)

- **Key**: `OAUTH_SERVER_URL`
- **Value**: `https://api.manus.im`

Clique em **Save Changes**

### Passo 4: Adicionar Variáveis Opcionais (Supabase)

Se você configurou o Supabase PostgreSQL (seguindo `SUPABASE_SETUP.md`), adicione:

**Variável 2: SUPABASE_URL** (OPCIONAL)

- **Key**: `SUPABASE_URL`
- **Value**: `https://xxxxx.supabase.co` (copie do Supabase Dashboard)

**Variável 3: SUPABASE_ANON_KEY** (OPCIONAL)

- **Key**: `SUPABASE_ANON_KEY`
- **Value**: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (copie do Supabase Dashboard)

Clique em **Save Changes**

### Passo 5: Aguardar Reinicialização

O Render vai reiniciar o servidor automaticamente (~2 minutos).

## ✅ Verificar se Funcionou

1. Aguarde o deploy completar
2. Acesse: https://btc-alerts-server.onrender.com/api/health
3. Você deve ver: `{"ok":true,"timestamp":...}`
4. Verifique os logs no Render:
   - ✅ **Sem erro de OAUTH_SERVER_URL**
   - ✅ `[Push] ✅ Supabase disponível` (se configurou Supabase)
   - ✅ `[api] server listening on port 3000`

## 📋 Resumo das Variáveis

| Variável | Obrigatória? | Valor | Descrição |
|----------|--------------|-------|-----------|
| `OAUTH_SERVER_URL` | ✅ Sim | `https://api.manus.im` | URL do servidor OAuth da Manus |
| `SUPABASE_URL` | ❌ Não | `https://xxxxx.supabase.co` | URL do projeto Supabase (persistência de tokens) |
| `SUPABASE_ANON_KEY` | ❌ Não | `eyJhbGci...` | Chave pública do Supabase |

## 🔍 Troubleshooting

### Erro: "OAUTH_SERVER_URL is not configured"

**Solução**: Adicione a variável `OAUTH_SERVER_URL=https://api.manus.im` no Render

### Erro: "Supabase não disponível"

**Solução**: 
- Se você **não quer** usar Supabase: ignore, o servidor vai usar memória
- Se você **quer** usar Supabase: configure `SUPABASE_URL` e `SUPABASE_ANON_KEY`

### Servidor não inicia

**Solução**:
1. Verifique os logs no Render Dashboard
2. Procure por erros em vermelho
3. Certifique-se de que `OAUTH_SERVER_URL` está configurado

## 📞 Suporte

Se tiver problemas:
1. Verifique os logs do Render: Dashboard → Logs
2. Teste o endpoint de health: `https://btc-alerts-server.onrender.com/api/health`
3. Verifique se as variáveis estão corretas: Dashboard → Environment

## 🎯 Próximos Passos

Após configurar o Render:

1. **Teste o servidor**: `curl https://btc-alerts-server.onrender.com/api/health`
2. **Instale o APK** no celular
3. **Abra a tela de Diagnóstico** no app
4. **Teste as notificações** clicando em "Testar Notificação"
