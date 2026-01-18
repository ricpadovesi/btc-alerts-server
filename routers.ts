import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
// import { chatAboutSignal } from "./signal-chat"; // Removido na limpeza
import { z } from "zod";
import {
  registerPushToken,
  unregisterPushToken,
  sendTestPush,
  sendSignalPush,
  sendOrderOpenedPush,
  sendOrderClosedPush,
  getAllPushTokens,
} from "./push-notifications";
import { serverTradingBot } from "./trading-bot";
import { serverBinanceExecutor } from "./binance-executor";

// Variável para rastrear keep-alive
let lastKeepAlive = Date.now();
let keepAliveCount = 0;

// Função para formatar uptime
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  
  return parts.join(' ');
}

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,

  // Health Check / Keep-Alive
  health: router({
    // Endpoint de keep-alive - pingar periodicamente para manter servidor acordado
    ping: publicProcedure.mutation(() => {
      lastKeepAlive = Date.now();
      keepAliveCount++;
      console.log(`[KeepAlive] Ping #${keepAliveCount} recebido`);
      return { 
        success: true, 
        timestamp: lastKeepAlive,
        count: keepAliveCount,
        message: 'Servidor acordado!'
      };
    }),

    // Status do servidor
    status: publicProcedure.query(() => {
      const uptime = process.uptime();
      const memoryUsage = process.memoryUsage();
      return {
        status: 'online',
        uptime: Math.floor(uptime),
        uptimeFormatted: formatUptime(uptime),
        lastKeepAlive,
        keepAliveCount,
        memory: {
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        },
        timestamp: Date.now(),
      };
    }),
  }),
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // Push Notifications
  push: router({
    // Registrar token do dispositivo
    register: publicProcedure
      .input(z.object({
        token: z.string(),
        deviceId: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const success = await registerPushToken(input.token, input.deviceId);
        return { success };
      }),

    // Remover token do dispositivo
    unregister: publicProcedure
      .input(z.object({ token: z.string() }))
      .mutation(async ({ input }) => {
        const success = await unregisterPushToken(input.token);
        return { success };
      }),

    // Enviar notificação de teste
    test: publicProcedure.mutation(async () => {
      const result = await sendTestPush();
      return result;
    }),

    // Enviar notificação de sinal
    signal: publicProcedure
      .input(z.object({
        system: z.string(),
        type: z.enum(["LONG", "SHORT"]),
        entryPrice: z.number(),
        score: z.number(),
        stopLoss: z.number().optional(),
        takeProfit: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const result = await sendSignalPush(input);
        return result;
      }),

    // Enviar notificação de ordem aberta
    orderOpened: publicProcedure
      .input(z.object({
        type: z.enum(["LONG", "SHORT"]),
        entryPrice: z.number(),
        stopLoss: z.number(),
        takeProfit: z.number(),
        positionValue: z.number(),
        source: z.enum(["paper", "real"]),
      }))
      .mutation(async ({ input }) => {
        const result = await sendOrderOpenedPush(input);
        return result;
      }),

    // Enviar notificação de ordem fechada
    orderClosed: publicProcedure
      .input(z.object({
        type: z.enum(["LONG", "SHORT"]),
        entryPrice: z.number(),
        exitPrice: z.number(),
        profitLoss: z.number(),
        profitLossPercent: z.number(),
        reason: z.enum(["TAKE_PROFIT", "STOP_LOSS", "MANUAL"]),
        source: z.enum(["paper", "real"]),
      }))
      .mutation(async ({ input }) => {
        const result = await sendOrderClosedPush(input);
        return result;
      }),

    // Obter quantidade de dispositivos registrados
    deviceCount: publicProcedure.query(async () => {
      const tokens = await getAllPushTokens();
      return { count: tokens.length };
    }),
  }),

  // Chatbot de Análise de Sinais removido na limpeza
  // signalChat: router({
  //   ask: publicProcedure
  //     .input(z.object({
  //       analysis: z.any(), // LiquidityAnalysis
  //       currentPrice: z.number(),
  //       userMessage: z.string(),
  //       history: z.array(z.object({
  //         role: z.enum(["user", "assistant"]),
  //         content: z.string()
  //       }))
  //     }))
  //     .mutation(async ({ input }) => {
  //       const response = await chatAboutSignal(
  //         input.analysis,
  //         input.currentPrice,
  //         input.userMessage,
  //         input.history
  //       );
  //       return { response };
  //     })
  // }),

  // Rota signalChat removida na limpeza
  
  // Trading Bot (servidor)
  bot: router({
    // Obter status do robô
    status: publicProcedure.query(() => {
      return serverTradingBot.getStatus();
    }),

    // Configurar e iniciar o robô
    configure: publicProcedure
      .input(z.object({
        enabled: z.boolean(),
        apiKey: z.string(),
        apiSecret: z.string(),
        testnet: z.boolean().default(true),
        leverage: z.number().min(1).max(125).default(15),
        accountPercentage: z.number().min(1).max(100).default(10),
        minScore: z.number().min(0).max(100).default(60),
        marginType: z.enum(['ISOLATED', 'CROSSED']).default('ISOLATED'),
      }))
      .mutation(async ({ input }) => {
        serverTradingBot.configure(input);
        
        if (input.enabled) {
          await serverTradingBot.start();
        } else {
          await serverTradingBot.stop();
        }
        
        return { success: true, status: serverTradingBot.getStatus() };
      }),

    // Parar o robô
    stop: publicProcedure.mutation(async () => {
      await serverTradingBot.stop();
      return { success: true };
    }),

    // Iniciar o robô
    start: publicProcedure.mutation(async () => {
      await serverTradingBot.start();
      return { success: true, status: serverTradingBot.getStatus() };
    }),

    // Obter logs do robô
    logs: publicProcedure.query(() => {
      return { logs: serverTradingBot.getLogs() };
    }),
  }),
});

export type AppRouter = typeof appRouter;
