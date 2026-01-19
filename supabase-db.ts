/**
 * Supabase Database Service
 * 
 * Gerencia tokens de push notification no Supabase PostgreSQL.
 * Substitui o armazenamento em memória por persistência real.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Configuração do Supabase (será lida das variáveis de ambiente)
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || '';

let supabase: SupabaseClient | null = null;

/**
 * Inicializa o cliente Supabase
 */
export function initSupabase(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('[Supabase] Credenciais não configuradas, usando modo em memória');
    return null;
  }

  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('[Supabase] ✅ Cliente inicializado');
  }

  return supabase;
}

/**
 * Cria a tabela de tokens se não existir
 */
export async function createPushTokensTable(): Promise<boolean> {
  const client = initSupabase();
  
  if (!client) {
    console.warn('[Supabase] Cliente não disponível');
    return false;
  }

  try {
    // Verificar se a tabela existe
    const { data, error } = await client
      .from('push_tokens')
      .select('token')
      .limit(1);

    if (error && error.code === '42P01') {
      // Tabela não existe, criar via SQL
      console.log('[Supabase] Criando tabela push_tokens...');
      
      // Nota: Em produção, use migrations do Supabase
      // Aqui apenas documentamos a estrutura necessária
      console.log('[Supabase] ⚠️ Execute este SQL no Supabase Dashboard:');
      console.log(`
        CREATE TABLE IF NOT EXISTS push_tokens (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          token TEXT UNIQUE NOT NULL,
          device_id TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          last_used TIMESTAMPTZ DEFAULT NOW(),
          is_active BOOLEAN DEFAULT TRUE
        );

        CREATE INDEX IF NOT EXISTS idx_push_tokens_token ON push_tokens(token);
        CREATE INDEX IF NOT EXISTS idx_push_tokens_active ON push_tokens(is_active);
      `);
      
      return false;
    }

    console.log('[Supabase] ✅ Tabela push_tokens existe');
    return true;
  } catch (error) {
    console.error('[Supabase] ❌ Erro ao verificar tabela:', error);
    return false;
  }
}

/**
 * Registra ou atualiza um token
 */
export async function registerToken(token: string, deviceId?: string): Promise<boolean> {
  const client = initSupabase();
  
  if (!client) {
    return false;
  }

  try {
    console.log('[Supabase] Registrando token:', token.substring(0, 30) + '...');

    // Upsert: insere se não existe, atualiza se existe
    const { error } = await client
      .from('push_tokens')
      .upsert({
        token,
        device_id: deviceId,
        last_used: new Date().toISOString(),
        is_active: true,
      }, {
        onConflict: 'token',
      });

    if (error) {
      console.error('[Supabase] ❌ Erro ao registrar token:', error);
      return false;
    }

    console.log('[Supabase] ✅ Token registrado com sucesso');
    return true;
  } catch (error) {
    console.error('[Supabase] ❌ Erro ao registrar token:', error);
    return false;
  }
}

/**
 * Remove um token
 */
export async function unregisterToken(token: string): Promise<boolean> {
  const client = initSupabase();
  
  if (!client) {
    return false;
  }

  try {
    const { error } = await client
      .from('push_tokens')
      .update({ is_active: false })
      .eq('token', token);

    if (error) {
      console.error('[Supabase] ❌ Erro ao remover token:', error);
      return false;
    }

    console.log('[Supabase] ✅ Token removido');
    return true;
  } catch (error) {
    console.error('[Supabase] ❌ Erro ao remover token:', error);
    return false;
  }
}

/**
 * Obtém todos os tokens ativos
 */
export async function getAllActiveTokens(): Promise<string[]> {
  const client = initSupabase();
  
  if (!client) {
    return [];
  }

  try {
    const { data, error } = await client
      .from('push_tokens')
      .select('token')
      .eq('is_active', true);

    if (error) {
      console.error('[Supabase] ❌ Erro ao buscar tokens:', error);
      return [];
    }

    const tokens = data?.map(row => row.token) || [];
    console.log(`[Supabase] ✅ ${tokens.length} token(s) ativo(s)`);
    return tokens;
  } catch (error) {
    console.error('[Supabase] ❌ Erro ao buscar tokens:', error);
    return [];
  }
}

/**
 * Atualiza last_used de um token
 */
export async function updateTokenLastUsed(token: string): Promise<boolean> {
  const client = initSupabase();
  
  if (!client) {
    return false;
  }

  try {
    const { error } = await client
      .from('push_tokens')
      .update({ last_used: new Date().toISOString() })
      .eq('token', token);

    if (error) {
      console.error('[Supabase] ❌ Erro ao atualizar token:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[Supabase] ❌ Erro ao atualizar token:', error);
    return false;
  }
}

/**
 * Limpa tokens inativos há mais de 30 dias
 */
export async function cleanupOldTokens(): Promise<number> {
  const client = initSupabase();
  
  if (!client) {
    return 0;
  }

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data, error } = await client
      .from('push_tokens')
      .delete()
      .eq('is_active', false)
      .lt('last_used', thirtyDaysAgo.toISOString())
      .select();

    if (error) {
      console.error('[Supabase] ❌ Erro ao limpar tokens:', error);
      return 0;
    }

    const count = data?.length || 0;
    console.log(`[Supabase] ✅ ${count} token(s) antigo(s) removido(s)`);
    return count;
  } catch (error) {
    console.error('[Supabase] ❌ Erro ao limpar tokens:', error);
    return 0;
  }
}
