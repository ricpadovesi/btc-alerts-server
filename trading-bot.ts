/**
 * Robô de Trading Automático no Servidor
 * 
 * Orquestra todos os serviços: monitoramento de preços, detecção de sinais,
 * execução de ordens e envio de notificações.
 * 
 * Roda 24/7 no servidor, independente do app estar aberto.
 */

import { serverPriceMonitor } from './price-monitor';
import { serverSignalDetector } from './signal-detector';
import { serverBinanceExecutor } from './binance-executor';
import { sendPushToAll, getAllPushTokens } from './push-notifications';
import { getDb } from './db';

interface BotConfig {
  enabled: boolean;
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
  leverage: number;
  accountPercentage: number;
  minScore: number;
  marginType: 'ISOLATED' | 'CROSSED';
}

interface BotStatus {
  running: boolean;
  configured: boolean;
  lastSignal: number; // timestamp do último sinal detectado
  lastOrder: number;
  totalOrders: number;
  priceMonitorConnected: boolean;
  signalDetectorCandles: number;
  currentPrice?: number;
}

interface BotLog {
  timestamp: number;
  type: 'info' | 'signal' | 'order' | 'error';
  message: string;
}

class ServerTradingBot {
  private config: BotConfig | null = null;
  private isRunning = false;
  private lastOrderTime = 0;
  private totalOrders = 0;
  private minOrderInterval = 5 * 60 * 1000; // 5 minutos entre ordens
  private logs: BotLog[] = [];
  private maxLogs = 100;
  private currentPrice = 0;

  /**
   * Configura o robô com as credenciais e parâmetros
   */
  configure(config: BotConfig): void {
    this.config = config;
    
    if (config.apiKey && config.apiSecret) {
      serverBinanceExecutor.configure({
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
        testnet: config.testnet,
      });
    }
    
    console.log('[TradingBot] Configuração atualizada:', {
      enabled: config.enabled,
      testnet: config.testnet,
      leverage: config.leverage,
      accountPercentage: config.accountPercentage,
      minScore: config.minScore,
    });
  }

  /**
   * Inicia o robô
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[TradingBot] Já está rodando');
      return;
    }

    console.log('[TradingBot] 🤖 Iniciando robô de trading...');
    this.isRunning = true;

    // Iniciar monitoramento de preços
    serverPriceMonitor.start();

    // Escutar preços para atualizar currentPrice
    serverPriceMonitor.onPrice((data) => {
      this.currentPrice = data.price;
    });

    // Iniciar detecção de sinais
    await serverSignalDetector.start();
    
    this.addLog('info', 'Robô de trading iniciado');

    // Escutar sinais detectados
    serverSignalDetector.onSignal(async (signal) => {
      await this.handleSignal(signal);
    });

    console.log('[TradingBot] ✅ Robô iniciado com sucesso!');
    
    // Enviar notificação de início
    await this.sendNotification(
      '🤖 Robô Iniciado',
      'O robô de trading está monitorando o mercado 24/7'
    );
  }

  /**
   * Para o robô
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    console.log('[TradingBot] Parando robô...');
    this.isRunning = false;

    serverPriceMonitor.stop();
    serverSignalDetector.stop();

    await this.sendNotification(
      '🛑 Robô Parado',
      'O robô de trading foi desativado'
    );
  }

  /**
   * Processa sinal detectado
   */
  private async handleSignal(signal: {
    type: 'LONG' | 'SHORT';
    entryPrice: number;
    stopLoss: number;
    takeProfit1: number;
    takeProfit2: number;
    takeProfit3: number;
    score: number;
    reason: string;
    timestamp: number;
  }): Promise<void> {
    this.addLog('signal', `Sinal ${signal.type} detectado - Score: ${signal.score}% @ $${signal.entryPrice.toFixed(2)}`);

    // Verificar se está habilitado
    if (!this.config?.enabled) {
      this.addLog('info', 'Robô desabilitado, sinal ignorado');
      return;
    }

    // Verificar score mínimo
    if (signal.score < (this.config.minScore || 60)) {
      this.addLog('info', `Score ${signal.score}% abaixo do mínimo ${this.config.minScore}%`);
      return;
    }

    // Verificar intervalo mínimo entre ordens
    const now = Date.now();
    if (now - this.lastOrderTime < this.minOrderInterval) {
      this.addLog('info', 'Aguardando intervalo mínimo entre ordens');
      return;
    }

    // Verificar se Binance está configurada
    if (!serverBinanceExecutor.isConfigured()) {
      this.addLog('info', 'Binance não configurada - enviando apenas notificação');
      await this.sendNotification(
        `🎯 Sinal ${signal.type} Detectado!`,
        `Score: ${signal.score}% | Entrada: $${signal.entryPrice.toFixed(2)}\nSL: $${signal.stopLoss.toFixed(2)} | TP: $${signal.takeProfit1.toFixed(2)}\n\n⚠️ Configure a API Binance para execução automática`
      );
      return;
    }

    // Executar ordem
    this.addLog('order', `Executando ${signal.type} @ $${signal.entryPrice.toFixed(2)}...`);
    
    const result = await serverBinanceExecutor.executeSignal({
      type: signal.type,
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit1,
      accountPercentage: this.config.accountPercentage || 10,
      leverage: this.config.leverage || 15,
    });

    if (result.success) {
      this.lastOrderTime = now;
      this.totalOrders++;
      
      this.addLog('order', `✅ ${signal.type} executado! Ordem #${result.orderId} - ${result.executedQty?.toFixed(4) || 'N/A'} BTC @ $${result.avgPrice?.toFixed(2) || signal.entryPrice.toFixed(2)}`);
      
      await this.sendNotification(
        `✅ ${signal.type} Executado!`,
        `Ordem #${result.orderId}\nPreço: $${result.avgPrice?.toFixed(2) || signal.entryPrice.toFixed(2)}\nQuantidade: ${result.executedQty?.toFixed(4) || 'N/A'} BTC\nSL: $${signal.stopLoss.toFixed(2)}\nTP: $${signal.takeProfit1.toFixed(2)}`
      );
    } else {
      this.addLog('error', `Erro ao executar ${signal.type}: ${result.error}`);
      
      await this.sendNotification(
        `❌ Erro ao Executar ${signal.type}`,
        `Motivo: ${result.error}\n\nSinal: Score ${signal.score}% @ $${signal.entryPrice.toFixed(2)}`
      );
    }
  }

  /**
   * Envia notificação push para todos os dispositivos
   */
  private async sendNotification(title: string, body: string): Promise<void> {
    try {
      const tokens = await getAllPushTokens();
      
      if (tokens.length === 0) {
        console.log('[TradingBot] Nenhum dispositivo registrado para push');
        return;
      }

      await sendPushToAll(title, body);
      console.log(`[TradingBot] Push enviado para ${tokens.length} dispositivo(s)`);
    } catch (error) {
      console.error('[TradingBot] Erro ao enviar push:', error);
    }
  }

  /**
   * Adiciona log ao histórico
   */
  private addLog(type: BotLog['type'], message: string): void {
    const log: BotLog = {
      timestamp: Date.now(),
      type,
      message,
    };
    
    this.logs.unshift(log); // Adicionar no início
    
    // Limitar tamanho
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }
    
    // Log no console também
    const prefix = type === 'error' ? '❌' : type === 'signal' ? '🎯' : type === 'order' ? '📈' : 'ℹ️';
    console.log(`[TradingBot] ${prefix} ${message}`);
  }

  /**
   * Obtém logs do robô
   */
  getLogs(): BotLog[] {
    return this.logs;
  }

  /**
   * Obtém status atual do robô
   */
  getStatus(): BotStatus {
    const detectorStatus = serverSignalDetector.getStatus();
    
    return {
      running: this.isRunning,
      configured: serverBinanceExecutor.isConfigured(),
      lastSignal: detectorStatus.lastSignal,
      lastOrder: this.lastOrderTime,
      totalOrders: this.totalOrders,
      priceMonitorConnected: serverPriceMonitor.isConnected(),
      signalDetectorCandles: detectorStatus.candles,
      currentPrice: this.currentPrice,
    };
  }

  /**
   * Atualiza configuração a partir do banco de dados
   */
  async loadConfigFromDB(userId?: number): Promise<void> {
    // Por enquanto, usar configuração padrão
    // TODO: Implementar carregamento do banco de dados
    console.log('[TradingBot] Carregando configuração...');
  }
}

// Instância singleton
export const serverTradingBot = new ServerTradingBot();
