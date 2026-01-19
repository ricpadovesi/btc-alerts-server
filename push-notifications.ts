/**
 * Push Notifications Service (Hybrid Version)
 * 
 * Usa Supabase PostgreSQL quando disponível, fallback para memória.
 * Envia notificações via Expo Push API.
 */

import * as supabaseDb from "./supabase-db";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// Armazenamento em memória como fallback
const pushTokensMemory = new Map<string, {
  token: string;
  deviceId?: string;
  createdAt: Date;
  lastUsed: Date;
}>();

// Flag para indicar se Supabase está disponível
let useSupabase = false;

/**
 * Inicializa o serviço de push notifications
 */
export async function initPushService(): Promise<void> {
  console.log('[Push] ===== INICIALIZANDO SERVIÇO DE PUSH =====');
  
  // Tentar inicializar Supabase
  const supabase = supabaseDb.initSupabase();
  
  if (supabase) {
    console.log('[Push] ✅ Supabase disponível, usando banco de dados');
    useSupabase = true;
    
    // Verificar/criar tabela
    await supabaseDb.createPushTokensTable();
  } else {
    console.log('[Push] ⚠️ Supabase não disponível, usando memória');
    useSupabase = false;
  }
  
  console.log('[Push] ===== SERVIÇO INICIALIZADO =====');
}

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
  priority?: "default" | "normal" | "high";
}

/**
 * Registra um Push Token
 */
export async function registerPushToken(token: string, deviceId?: string): Promise<boolean> {
  try {
    console.log('[Push] [REGISTER] ========================================');
    console.log('[Push] [REGISTER] REGISTRANDO TOKEN');
    console.log('[Push] [REGISTER] ========================================');
    console.log(`[Push] [REGISTER] Token: ${token.substring(0, 50)}...`);
    console.log(`[Push] [REGISTER] DeviceId: ${deviceId || 'não fornecido'}`);
    console.log(`[Push] [REGISTER] Usando: ${useSupabase ? 'Supabase PostgreSQL' : 'Memória'}`);
    
    if (useSupabase) {
      // Tentar registrar no Supabase
      const success = await supabaseDb.registerToken(token, deviceId);
      
      if (success) {
        console.log('[Push] [REGISTER] ✅ Token registrado no Supabase');
        return true;
      } else {
        console.warn('[Push] [REGISTER] ⚠️ Falha no Supabase, usando memória como fallback');
        useSupabase = false; // Desabilitar Supabase temporariamente
      }
    }
    
    // Fallback para memória
    const existing = pushTokensMemory.get(token);
    
    if (existing) {
      console.log('[Push] [REGISTER] Token já existe em memória, atualizando lastUsed...');
      existing.lastUsed = new Date();
      pushTokensMemory.set(token, existing);
      console.log('[Push] [REGISTER] ✅ Token atualizado');
    } else {
      console.log('[Push] [REGISTER] Inserindo novo token em memória...');
      pushTokensMemory.set(token, {
        token,
        deviceId,
        createdAt: new Date(),
        lastUsed: new Date(),
      });
      console.log('[Push] [REGISTER] ✅ NOVO TOKEN REGISTRADO!');
    }
    
    console.log(`[Push] [REGISTER] Total de tokens: ${pushTokensMemory.size} (memória)`);
    console.log('[Push] [REGISTER] ========================================');
    return true;
  } catch (error) {
    console.error('[Push] [REGISTER] ❌ ERRO ao registrar token:', error);
    console.log('[Push] [REGISTER] ========================================');
    return false;
  }
}

/**
 * Remove um Push Token
 */
export async function unregisterPushToken(token: string): Promise<boolean> {
  try {
    if (useSupabase) {
      const success = await supabaseDb.unregisterToken(token);
      if (success) {
        console.log("[Push] Token removido do Supabase:", token.substring(0, 30) + "...");
        return true;
      }
    }
    
    // Fallback para memória
    const deleted = pushTokensMemory.delete(token);
    if (deleted) {
      console.log("[Push] Token removido da memória:", token.substring(0, 30) + "...");
    }
    return deleted;
  } catch (error) {
    console.error("[Push] Erro ao remover token:", error);
    return false;
  }
}

/**
 * Obtém todos os tokens registrados
 */
export async function getAllPushTokens(): Promise<string[]> {
  try {
    if (useSupabase) {
      const tokens = await supabaseDb.getAllActiveTokens();
      
      if (tokens.length > 0) {
        console.log(`[Push] ✅ ${tokens.length} token(s) do Supabase`);
        return tokens;
      } else {
        console.warn('[Push] ⚠️ Nenhum token no Supabase, usando memória');
      }
    }
    
    // Fallback para memória
    const tokens = Array.from(pushTokensMemory.values()).map(t => t.token);
    console.log(`[Push] ✅ ${tokens.length} token(s) da memória`);
    return tokens;
  } catch (error) {
    console.error('[Push] ❌ Erro ao buscar tokens:', error);
    return Array.from(pushTokensMemory.values()).map(t => t.token);
  }
}

/**
 * Envia notificação push para todos os dispositivos registrados
 */
export async function sendPushToAll(titleOrMessage: string | PushMessage, body?: string): Promise<{
  success: boolean;
  sent: number;
  failed: number;
  errors: string[];
}> {
  console.log('[Push] [SEND] ========================================');
  console.log('[Push] [SEND] ENVIANDO NOTIFICACAO PUSH');
  console.log('[Push] [SEND] ========================================');
  
  // Normalizar para PushMessage
  const message: PushMessage = typeof titleOrMessage === 'string'
    ? { title: titleOrMessage, body: body || '' }
    : titleOrMessage;

  console.log(`[Push] [SEND] Título: ${message.title}`);
  console.log(`[Push] [SEND] Corpo: ${message.body}`);

  const tokens = await getAllPushTokens();
  
  if (tokens.length === 0) {
    console.error('[Push] [SEND] ❌ NENHUM DISPOSITIVO REGISTRADO!');
    console.log('[Push] [SEND] ========================================');
    return { success: true, sent: 0, failed: 0, errors: [] };
  }

  console.log(`[Push] [SEND] ✅ Enviando para ${tokens.length} dispositivo(s)...`);
  console.log(`[Push] [SEND] Usando: Expo Push API`);

  // Montar mensagens para Expo Push API
  const messages = tokens.map((token) => ({
    to: token,
    title: message.title,
    body: message.body,
    data: message.data || {},
    sound: message.sound || "default",
    badge: message.badge,
    channelId: message.channelId || "default",
    priority: message.priority || "high",
  }));

  try {
    const results: { success: boolean; error?: string }[] = [];
    
    // Enviar em lotes de 100 (limite da API Expo)
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      
      console.log(`[Push] [SEND] Enviando lote ${Math.floor(i / 100) + 1}/${Math.ceil(messages.length / 100)}...`);
      
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
      });

      console.log(`[Push] [SEND] Status da resposta: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Push] [SEND] ❌ ERRO na API Expo: ${errorText}`);
        results.push(...batch.map(() => ({ success: false, error: errorText })));
        continue;
      }

      const data = await response.json();
      
      if (data.data) {
        for (const ticket of data.data) {
          if (ticket.status === "ok") {
            results.push({ success: true });
          } else {
            results.push({ success: false, error: ticket.message || "Unknown error" });
            
            // Se token inválido, remover
            if (ticket.details?.error === "DeviceNotRegistered") {
              const tokenIndex = results.length - 1;
              if (tokenIndex < tokens.length) {
                await unregisterPushToken(tokens[tokenIndex]);
              }
            }
          }
        }
      }
    }

    const sent = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    const errors = results.filter((r) => r.error).map((r) => r.error!);

    console.log('[Push] [SEND] ========================================');
    console.log(`[Push] [SEND] ✅ RESULTADO: ${sent} enviados, ${failed} falhas`);
    console.log('[Push] [SEND] ========================================');
    
    return {
      success: failed === 0,
      sent,
      failed,
      errors: [...new Set(errors)],
    };
  } catch (error) {
    console.error('[Push] [SEND] ❌ ERRO ao enviar notificações:', error);
    console.log('[Push] [SEND] ========================================');
    return {
      success: false,
      sent: 0,
      failed: tokens.length,
      errors: [error instanceof Error ? error.message : "Unknown error"],
    };
  }
}

/**
 * Envia notificação de sinal detectado
 */
export async function sendSignalPush(signal: {
  system: string;
  type: "LONG" | "SHORT";
  entryPrice: number;
  score: number;
  stopLoss?: number;
  takeProfit?: number;
}) {
  const emoji = signal.type === "LONG" ? "🟢" : "🔴";
  const action = signal.type === "LONG" ? "COMPRA" : "VENDA";

  return sendPushToAll({
    title: `${emoji} Sinal ${action} Detectado!`,
    body: `${signal.system} - Score: ${signal.score}/100\nPreço: $${signal.entryPrice.toFixed(2)}`,
    data: {
      type: "signal",
      signal: JSON.stringify(signal),
    },
    priority: "high",
    channelId: "signals",
  });
}

/**
 * Envia notificação de teste
 */
export async function sendTestPush() {
  return sendPushToAll({
    title: "🔔 Teste de Notificação",
    body: "Se você está vendo isso, as notificações push estão funcionando!",
    data: {
      type: "test",
      timestamp: new Date().toISOString(),
    },
    priority: "high",
  });
}
