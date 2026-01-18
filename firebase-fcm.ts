/**
 * Firebase Cloud Messaging (FCM) Service
 * 
 * Envia notificações push via Firebase Admin SDK.
 * Funciona com app fechado, tela bloqueada, e em múltiplos dispositivos.
 */

import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

// Inicializar Firebase Admin SDK
let firebaseApp: admin.app.App | null = null;

function initializeFirebase(): admin.app.App {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    // Tentar carregar Service Account do arquivo
    const serviceAccountPath = path.join(__dirname, 'firebase-service-account.json');
    
    if (fs.existsSync(serviceAccountPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
      
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
      
      console.log('[FCM] ✅ Firebase Admin SDK inicializado com sucesso!');
      console.log(`[FCM] Project ID: ${serviceAccount.project_id}`);
    } else {
      console.error('[FCM] ❌ Arquivo firebase-service-account.json não encontrado!');
      throw new Error('Firebase Service Account não encontrado');
    }
  } catch (error) {
    console.error('[FCM] ❌ Erro ao inicializar Firebase:', error);
    throw error;
  }

  return firebaseApp;
}

// Inicializar ao carregar o módulo
try {
  initializeFirebase();
} catch (error) {
  console.error('[FCM] Falha na inicialização:', error);
}

export interface FCMMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
}

/**
 * Envia notificação para um token FCM específico
 */
export async function sendToToken(token: string, message: FCMMessage): Promise<boolean> {
  try {
    const app = initializeFirebase();
    
    console.log('[FCM] [SEND] ========================================');
    console.log('[FCM] [SEND] ENVIANDO NOTIFICACAO VIA FCM');
    console.log('[FCM] [SEND] ========================================');
    console.log(`[FCM] [SEND] Token: ${token.substring(0, 50)}...`);
    console.log(`[FCM] [SEND] Título: ${message.title}`);
    console.log(`[FCM] [SEND] Corpo: ${message.body}`);

    const fcmMessage: admin.messaging.Message = {
      token: token,
      notification: {
        title: message.title,
        body: message.body,
        imageUrl: message.imageUrl,
      },
      data: message.data || {},
      android: {
        priority: 'high',
        notification: {
          channelId: 'default',
          priority: 'high',
          defaultSound: true,
          defaultVibrateTimings: true,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    const response = await admin.messaging(app).send(fcmMessage);
    
    console.log(`[FCM] [SEND] ✅ Notificação enviada! Message ID: ${response}`);
    console.log('[FCM] [SEND] ========================================');
    
    return true;
  } catch (error: any) {
    console.error('[FCM] [SEND] ❌ Erro ao enviar notificação:', error.message);
    console.log('[FCM] [SEND] ========================================');
    return false;
  }
}

/**
 * Envia notificação para múltiplos tokens FCM
 */
export async function sendToMultipleTokens(tokens: string[], message: FCMMessage): Promise<{
  success: number;
  failed: number;
  errors: string[];
}> {
  if (tokens.length === 0) {
    console.log('[FCM] Nenhum token para enviar');
    return { success: 0, failed: 0, errors: [] };
  }

  try {
    const app = initializeFirebase();
    
    console.log('[FCM] [MULTI] ========================================');
    console.log('[FCM] [MULTI] ENVIANDO PARA MULTIPLOS DISPOSITIVOS');
    console.log('[FCM] [MULTI] ========================================');
    console.log(`[FCM] [MULTI] Total de tokens: ${tokens.length}`);
    console.log(`[FCM] [MULTI] Título: ${message.title}`);

    const fcmMessage: admin.messaging.MulticastMessage = {
      tokens: tokens,
      notification: {
        title: message.title,
        body: message.body,
        imageUrl: message.imageUrl,
      },
      data: message.data || {},
      android: {
        priority: 'high',
        notification: {
          channelId: 'default',
          priority: 'high',
          defaultSound: true,
          defaultVibrateTimings: true,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    const response = await admin.messaging(app).sendEachForMulticast(fcmMessage);
    
    const errors: string[] = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success && resp.error) {
        errors.push(`Token ${idx}: ${resp.error.message}`);
      }
    });

    console.log(`[FCM] [MULTI] ✅ Resultado: ${response.successCount} enviados, ${response.failureCount} falhas`);
    console.log('[FCM] [MULTI] ========================================');

    return {
      success: response.successCount,
      failed: response.failureCount,
      errors: errors,
    };
  } catch (error: any) {
    console.error('[FCM] [MULTI] ❌ Erro ao enviar notificações:', error.message);
    return {
      success: 0,
      failed: tokens.length,
      errors: [error.message],
    };
  }
}

/**
 * Envia notificação de sinal de trading
 */
export async function sendSignalNotification(tokens: string[], signal: {
  system: string;
  type: 'LONG' | 'SHORT';
  entryPrice: number;
  score: number;
}) {
  const emoji = signal.type === 'LONG' ? '🟢' : '🔴';
  const action = signal.type === 'LONG' ? 'COMPRA' : 'VENDA';

  return sendToMultipleTokens(tokens, {
    title: `${emoji} Sinal ${action} Detectado!`,
    body: `${signal.system} - Score: ${signal.score}/100\nPreço: $${signal.entryPrice.toFixed(2)}`,
    data: {
      type: 'signal',
      system: signal.system,
      signalType: signal.type,
      entryPrice: signal.entryPrice.toString(),
      score: signal.score.toString(),
    },
  });
}

/**
 * Envia notificação de ordem aberta
 */
export async function sendOrderOpenedNotification(tokens: string[], order: {
  type: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  source: 'paper' | 'real';
}) {
  const emoji = order.type === 'LONG' ? '📈' : '📉';
  const action = order.type === 'LONG' ? 'COMPRA' : 'VENDA';
  const sourceText = order.source === 'paper' ? '[Paper]' : '[Real]';

  return sendToMultipleTokens(tokens, {
    title: `${emoji} ${sourceText} Ordem ${action} Aberta!`,
    body: `Entrada: $${order.entryPrice.toFixed(2)}\nSL: $${order.stopLoss.toFixed(2)} | TP: $${order.takeProfit.toFixed(2)}`,
    data: {
      type: 'order_opened',
      orderType: order.type,
      entryPrice: order.entryPrice.toString(),
      stopLoss: order.stopLoss.toString(),
      takeProfit: order.takeProfit.toString(),
      source: order.source,
    },
  });
}

/**
 * Envia notificação de ordem fechada
 */
export async function sendOrderClosedNotification(tokens: string[], order: {
  type: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  profitLoss: number;
  profitLossPercent: number;
  reason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'MANUAL';
  source: 'paper' | 'real';
}) {
  const isWin = order.profitLoss > 0;
  const emoji = isWin ? '🎉' : '😔';
  const resultText = isWin ? 'LUCRO' : 'PREJUÍZO';
  const sourceText = order.source === 'paper' ? '[Paper]' : '[Real]';
  const reasonText = order.reason === 'TAKE_PROFIT' ? 'TP Atingido' 
    : order.reason === 'STOP_LOSS' ? 'SL Atingido' 
    : 'Fechamento Manual';

  return sendToMultipleTokens(tokens, {
    title: `${emoji} ${sourceText} Ordem Fechada - ${resultText}!`,
    body: `${reasonText}\n$${order.entryPrice.toFixed(2)} → $${order.exitPrice.toFixed(2)}\nResultado: ${order.profitLoss >= 0 ? '+' : ''}$${order.profitLoss.toFixed(2)} (${order.profitLossPercent >= 0 ? '+' : ''}${order.profitLossPercent.toFixed(2)}%)`,
    data: {
      type: 'order_closed',
      orderType: order.type,
      entryPrice: order.entryPrice.toString(),
      exitPrice: order.exitPrice.toString(),
      profitLoss: order.profitLoss.toString(),
      profitLossPercent: order.profitLossPercent.toString(),
      reason: order.reason,
      source: order.source,
    },
  });
}

/**
 * Envia notificação de teste
 */
export async function sendTestNotification(tokens: string[]) {
  return sendToMultipleTokens(tokens, {
    title: '🔔 Teste de Notificação FCM',
    body: 'Se você está vendo isso, as notificações Firebase estão funcionando!',
    data: {
      type: 'test',
      timestamp: new Date().toISOString(),
    },
  });
}

export { initializeFirebase };
