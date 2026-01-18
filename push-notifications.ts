/**
 * Push Notifications Service
 * 
 * Envia notificações push para dispositivos registrados.
 * Suporta Expo Push API e Firebase Cloud Messaging (FCM).
 * Funciona com app fechado, tela bloqueada, e em múltiplos dispositivos.
 */

import { getDb } from "./db";
import { pushTokens } from "./drizzle/schema.js";
import { eq } from "drizzle-orm";
import * as fcm from "./firebase-fcm";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// Flag para usar FCM ao invés de Expo Push API
const USE_FCM = true;

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
 * Registra um Expo Push Token no banco de dados
 */
export async function registerPushToken(token: string, deviceId?: string): Promise<boolean> {
  try {
    console.log('[Push] [REGISTER] ========================================');
    console.log('[Push] [REGISTER] REGISTRANDO TOKEN NO SERVIDOR');
    console.log('[Push] [REGISTER] ========================================');
    console.log(`[Push] [REGISTER] Token: ${token}`);
    console.log(`[Push] [REGISTER] DeviceId: ${deviceId || 'não fornecido'}`);
    
    const db = await getDb();
    if (!db) {
      console.error('[Push] [REGISTER] ❌ Database não disponível');
      return false;
    }
    
    console.log('[Push] [REGISTER] ✅ Database conectado');

    // Verificar se token já existe
    const existing = await db
      .select()
      .from(pushTokens)
      .where(eq(pushTokens.token, token))
      .limit(1);

    if (existing.length > 0) {
      console.log('[Push] [REGISTER] Token já existe, atualizando lastUsed...');
      // Atualizar lastUsed
      await db
        .update(pushTokens)
        .set({ lastUsed: new Date() })
        .where(eq(pushTokens.token, token));
      console.log('[Push] [REGISTER] ✅ Token atualizado com sucesso');
      return true;
    }

    console.log('[Push] [REGISTER] Inserindo novo token no banco...');
    // Inserir novo token
    await db.insert(pushTokens).values({
      token,
      deviceId: deviceId || null,
      createdAt: new Date(),
      lastUsed: new Date(),
    });

    console.log('[Push] [REGISTER] ✅ NOVO TOKEN REGISTRADO COM SUCESSO!');
    console.log('[Push] [REGISTER] ========================================');
    return true;
  } catch (error) {
    console.error('[Push] [REGISTER] ❌ ERRO ao registrar token:', error);
    console.log('[Push] [REGISTER] ========================================');
    return false;
  }
}

/**
 * Remove um Expo Push Token do banco de dados
 */
export async function unregisterPushToken(token: string): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;

    await db.delete(pushTokens).where(eq(pushTokens.token, token));
    console.log("[Push] Token removido:", token.substring(0, 30) + "...");
    return true;
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
    const db = await getDb();
    if (!db) return [];

    const tokens = await db.select({ token: pushTokens.token }).from(pushTokens);
    return tokens.map((t) => t.token);
  } catch (error) {
    console.error("[Push] Erro ao buscar tokens:", error);
    return [];
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
  console.log(`[Push] [SEND] Usando: ${USE_FCM ? 'Firebase Cloud Messaging (FCM)' : 'Expo Push API'}`);

  // Se usar FCM, enviar via Firebase
  if (USE_FCM) {
    try {
      // Converter data para Record<string, string> (FCM requer strings)
      const fcmData: Record<string, string> = {};
      if (message.data) {
        Object.entries(message.data).forEach(([key, value]) => {
          fcmData[key] = typeof value === 'string' ? value : JSON.stringify(value);
        });
      }

      const result = await fcm.sendToMultipleTokens(tokens, {
        title: message.title,
        body: message.body,
        data: fcmData,
      });

      console.log('[Push] [SEND] ========================================');
      console.log(`[Push] [SEND] ✅ RESULTADO FCM: ${result.success} enviados, ${result.failed} falhas`);
      console.log('[Push] [SEND] ========================================');

      return {
        success: result.failed === 0,
        sent: result.success,
        failed: result.failed,
        errors: result.errors,
      };
    } catch (error) {
      console.error('[Push] [SEND] ❌ ERRO FCM:', error);
      console.log('[Push] [SEND] ========================================');
      return {
        success: false,
        sent: 0,
        failed: tokens.length,
        errors: [error instanceof Error ? error.message : 'FCM Error'],
      };
    }
  }

  // Fallback: Expo Push API
  // Preparar mensagens para cada token
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
    // Enviar em lotes de 100 (limite da Expo)
    const results: { success: boolean; error?: string }[] = [];
    
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
      
      // Processar resultados
      if (data.data) {
        for (const ticket of data.data) {
          if (ticket.status === "ok") {
            results.push({ success: true });
          } else {
            results.push({ success: false, error: ticket.message || "Unknown error" });
            
            // Se token inválido, remover do banco
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
      errors: [...new Set(errors)], // Remover duplicados
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
      signal,
    },
    priority: "high",
    channelId: "signals",
  });
}

/**
 * Envia notificação de ordem aberta
 */
export async function sendOrderOpenedPush(order: {
  type: "LONG" | "SHORT";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  positionValue: number;
  source: "paper" | "real";
}) {
  const emoji = order.type === "LONG" ? "📈" : "📉";
  const action = order.type === "LONG" ? "COMPRA" : "VENDA";
  const sourceText = order.source === "paper" ? "[Paper]" : "[Real]";

  return sendPushToAll({
    title: `${emoji} ${sourceText} Ordem ${action} Aberta!`,
    body: `Entrada: $${order.entryPrice.toFixed(2)}\nSL: $${order.stopLoss.toFixed(2)} | TP: $${order.takeProfit.toFixed(2)}`,
    data: {
      type: "order_opened",
      order,
    },
    priority: "high",
    channelId: "orders",
  });
}

/**
 * Envia notificação de ordem fechada
 */
export async function sendOrderClosedPush(order: {
  type: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  profitLoss: number;
  profitLossPercent: number;
  reason: "TAKE_PROFIT" | "STOP_LOSS" | "MANUAL";
  source: "paper" | "real";
}) {
  const isWin = order.profitLoss > 0;
  const emoji = isWin ? "🎉" : "😔";
  const resultText = isWin ? "LUCRO" : "PREJUÍZO";
  const sourceText = order.source === "paper" ? "[Paper]" : "[Real]";
  const reasonText =
    order.reason === "TAKE_PROFIT"
      ? "TP Atingido"
      : order.reason === "STOP_LOSS"
      ? "SL Atingido"
      : "Fechamento Manual";

  return sendPushToAll({
    title: `${emoji} ${sourceText} Ordem Fechada - ${resultText}!`,
    body: `${reasonText}\n$${order.entryPrice.toFixed(2)} → $${order.exitPrice.toFixed(2)}\nResultado: ${order.profitLoss >= 0 ? "+" : ""}$${order.profitLoss.toFixed(2)} (${order.profitLossPercent >= 0 ? "+" : ""}${order.profitLossPercent.toFixed(2)}%)`,
    data: {
      type: "order_closed",
      order,
    },
    priority: "high",
    channelId: "orders",
    sound: isWin ? "default" : "default",
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
