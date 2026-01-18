/**
 * Serviço de Monitoramento de Preços no Servidor
 * 
 * Conecta ao WebSocket da Binance e monitora preços em tempo real.
 * Roda 24/7 no servidor, independente do app estar aberto.
 */

import WebSocket from 'ws';

interface PriceData {
  symbol: string;
  price: number;
  timestamp: number;
  volume24h: number;
  priceChange24h: number;
  priceChangePercent24h: number;
}

type PriceCallback = (data: PriceData) => void;

class ServerPriceMonitor {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 5000;
  private callbacks: PriceCallback[] = [];
  private lastPrice: PriceData | null = null;
  private isRunning = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Inicia o monitoramento de preços
   */
  start(): void {
    if (this.isRunning) {
      console.log('[PriceMonitor] Já está rodando');
      return;
    }

    console.log('[PriceMonitor] Iniciando monitoramento de preços...');
    this.isRunning = true;
    this.connect();
  }

  /**
   * Para o monitoramento
   */
  stop(): void {
    console.log('[PriceMonitor] Parando monitoramento...');
    this.isRunning = false;
    
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Conecta ao WebSocket da Binance
   */
  private connect(): void {
    if (!this.isRunning) return;

    // WebSocket da Binance Futures para ticker de BTCUSDT
    const wsUrl = 'wss://fstream.binance.com/ws/btcusdt@ticker';
    
    console.log('[PriceMonitor] Conectando ao WebSocket da Binance...');
    
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      console.log('[PriceMonitor] ✅ Conectado ao WebSocket da Binance');
      this.reconnectAttempts = 0;
      
      // Ping a cada 30 segundos para manter conexão viva
      this.pingInterval = setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.ping();
        }
      }, 30000);
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const ticker = JSON.parse(data.toString());
        
        const priceData: PriceData = {
          symbol: ticker.s || 'BTCUSDT',
          price: parseFloat(ticker.c), // Current price
          timestamp: ticker.E || Date.now(),
          volume24h: parseFloat(ticker.v || '0'),
          priceChange24h: parseFloat(ticker.p || '0'),
          priceChangePercent24h: parseFloat(ticker.P || '0'),
        };

        this.lastPrice = priceData;
        
        // Notificar todos os callbacks
        this.callbacks.forEach(cb => {
          try {
            cb(priceData);
          } catch (err) {
            console.error('[PriceMonitor] Erro no callback:', err);
          }
        });
      } catch (err) {
        console.error('[PriceMonitor] Erro ao processar mensagem:', err);
      }
    });

    this.ws.on('close', () => {
      console.log('[PriceMonitor] WebSocket desconectado');
      
      if (this.pingInterval) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }
      
      // Reconectar se ainda estiver rodando
      if (this.isRunning) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (error) => {
      console.error('[PriceMonitor] Erro no WebSocket:', error.message);
    });

    this.ws.on('pong', () => {
      // Conexão ainda viva
    });
  }

  /**
   * Agenda reconexão com backoff exponencial
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[PriceMonitor] Máximo de tentativas de reconexão atingido');
      // Reset e tenta novamente após 1 minuto
      setTimeout(() => {
        this.reconnectAttempts = 0;
        this.connect();
      }, 60000);
      return;
    }

    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts);
    this.reconnectAttempts++;
    
    console.log(`[PriceMonitor] Reconectando em ${delay / 1000}s (tentativa ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Registra callback para receber atualizações de preço
   */
  onPrice(callback: PriceCallback): () => void {
    this.callbacks.push(callback);
    
    // Retorna função para remover callback
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index > -1) {
        this.callbacks.splice(index, 1);
      }
    };
  }

  /**
   * Obtém último preço conhecido
   */
  getLastPrice(): PriceData | null {
    return this.lastPrice;
  }

  /**
   * Verifica se está conectado
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

// Instância singleton
export const serverPriceMonitor = new ServerPriceMonitor();
