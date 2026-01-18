/**
 * Serviço de Detecção de Sinais no Servidor
 * 
 * Analisa preços e detecta sinais de trading usando indicadores técnicos.
 * Roda 24/7 no servidor, independente do app estar aberto.
 */

import { serverPriceMonitor } from './price-monitor';

// Tipos
interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

interface Signal {
  type: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  score: number;
  reason: string;
  timestamp: number;
}

type SignalCallback = (signal: Signal) => void;

class ServerSignalDetector {
  private candles: Candle[] = [];
  private maxCandles = 200;
  private lastCandleTime = 0;
  private candleInterval = 5 * 60 * 1000; // 5 minutos
  private currentCandle: Candle | null = null;
  private callbacks: SignalCallback[] = [];
  private lastSignalTime = 0;
  private minSignalInterval = 5 * 60 * 1000; // Mínimo 5 minutos entre sinais
  private isRunning = false;
  private analysisInterval: ReturnType<typeof setInterval> | null = null;
  private historyLoaded = false;

  /**
   * Inicia a detecção de sinais
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[SignalDetector] Já está rodando');
      return;
    }

    console.log('[SignalDetector] Iniciando detecção de sinais...');
    this.isRunning = true;

    // Carregar candles históricos PRIMEIRO (para começar a operar imediatamente)
    if (!this.historyLoaded) {
      await this.loadHistoricalCandles();
    }

    // Escutar atualizações de preço
    serverPriceMonitor.onPrice((data) => {
      this.processPrice(data.price, data.timestamp);
    });

    // Analisar a cada 1 minuto
    this.analysisInterval = setInterval(() => {
      this.analyzeMarket();
    }, 60 * 1000);

    // Fazer primeira análise imediatamente
    setTimeout(() => this.analyzeMarket(), 5000);

    console.log('[SignalDetector] ✅ Detecção de sinais iniciada');
  }

  /**
   * Carrega candles históricos da API REST da Binance
   * Isso permite começar a operar imediatamente sem esperar horas
   */
  private async loadHistoricalCandles(): Promise<void> {
    console.log('[SignalDetector] 📊 Carregando candles históricos...');
    
    try {
      // Buscar últimos 100 candles de 5 minutos
      const response = await fetch(
        'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=5m&limit=100'
      );
      
      if (!response.ok) {
        throw new Error(`API retornou ${response.status}`);
      }

      const data = await response.json();
      
      // Converter para formato Candle
      this.candles = data.map((k: any[]) => ({
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        timestamp: k[0],
      }));

      // Atualizar lastCandleTime
      if (this.candles.length > 0) {
        this.lastCandleTime = this.candles[this.candles.length - 1].timestamp;
      }

      this.historyLoaded = true;
      console.log(`[SignalDetector] ✅ ${this.candles.length} candles históricos carregados!`);
      console.log(`[SignalDetector] 🚀 Pronto para detectar sinais imediatamente!`);
    } catch (error) {
      console.error('[SignalDetector] ❌ Erro ao carregar histórico:', error);
      console.log('[SignalDetector] Continuando com coleta em tempo real...');
    }
  }

  /**
   * Para a detecção
   */
  stop(): void {
    console.log('[SignalDetector] Parando detecção...');
    this.isRunning = false;
    
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }
  }

  /**
   * Processa atualização de preço e atualiza candles
   */
  private processPrice(price: number, timestamp: number): void {
    const candleTime = Math.floor(timestamp / this.candleInterval) * this.candleInterval;

    if (candleTime > this.lastCandleTime) {
      // Novo candle
      if (this.currentCandle) {
        this.candles.push(this.currentCandle);
        if (this.candles.length > this.maxCandles) {
          this.candles.shift();
        }
      }

      this.currentCandle = {
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
        timestamp: candleTime,
      };
      this.lastCandleTime = candleTime;
    } else if (this.currentCandle) {
      // Atualizar candle atual
      this.currentCandle.high = Math.max(this.currentCandle.high, price);
      this.currentCandle.low = Math.min(this.currentCandle.low, price);
      this.currentCandle.close = price;
    }
  }

  /**
   * Analisa o mercado e detecta sinais
   */
  private analyzeMarket(): void {
    if (this.candles.length < 50) {
      console.log(`[SignalDetector] Aguardando mais candles (${this.candles.length}/50)`);
      return;
    }

    const now = Date.now();
    if (now - this.lastSignalTime < this.minSignalInterval) {
      return; // Muito cedo para novo sinal
    }

    const closes = this.candles.map(c => c.close);
    const currentPrice = this.currentCandle?.close || closes[closes.length - 1];

    // Calcular indicadores
    const ema20 = this.calculateEMA(closes, 20);
    const ema50 = this.calculateEMA(closes, 50);
    const rsi = this.calculateRSI(closes, 14);
    const macd = this.calculateMACD(closes);

    // Detectar sinal
    const signal = this.detectSignal(currentPrice, ema20, ema50, rsi, macd);

    if (signal) {
      this.lastSignalTime = now;
      signal.timestamp = now;
      
      console.log('[SignalDetector] 🎯 SINAL DETECTADO:', signal);
      
      // Notificar callbacks
      this.callbacks.forEach(cb => {
        try {
          cb(signal);
        } catch (err) {
          console.error('[SignalDetector] Erro no callback:', err);
        }
      });
    }
  }

  /**
   * Detecta sinal baseado nos indicadores
   */
  private detectSignal(
    price: number,
    ema20: number,
    ema50: number,
    rsi: number,
    macd: { macd: number; signal: number; histogram: number }
  ): Signal | null {
    let score = 0;
    let type: 'LONG' | 'SHORT' | null = null;
    const reasons: string[] = [];

    // Tendência (EMA)
    if (price > ema20 && ema20 > ema50) {
      score += 25;
      reasons.push('Tendência de alta (EMA)');
      type = 'LONG';
    } else if (price < ema20 && ema20 < ema50) {
      score += 25;
      reasons.push('Tendência de baixa (EMA)');
      type = 'SHORT';
    }

    // RSI
    if (type === 'LONG' && rsi > 40 && rsi < 70) {
      score += 20;
      reasons.push(`RSI favorável (${rsi.toFixed(1)})`);
    } else if (type === 'SHORT' && rsi < 60 && rsi > 30) {
      score += 20;
      reasons.push(`RSI favorável (${rsi.toFixed(1)})`);
    }

    // MACD
    if (type === 'LONG' && macd.histogram > 0 && macd.macd > macd.signal) {
      score += 25;
      reasons.push('MACD bullish');
    } else if (type === 'SHORT' && macd.histogram < 0 && macd.macd < macd.signal) {
      score += 25;
      reasons.push('MACD bearish');
    }

    // Momentum (preço vs EMA20)
    const distanceFromEMA = ((price - ema20) / ema20) * 100;
    if (type === 'LONG' && distanceFromEMA > 0.1 && distanceFromEMA < 2) {
      score += 15;
      reasons.push('Momentum positivo');
    } else if (type === 'SHORT' && distanceFromEMA < -0.1 && distanceFromEMA > -2) {
      score += 15;
      reasons.push('Momentum negativo');
    }

    // Força da tendência
    const emaDiff = ((ema20 - ema50) / ema50) * 100;
    if (Math.abs(emaDiff) > 0.5) {
      score += 15;
      reasons.push('Tendência forte');
    }

    // Só emitir sinal se score >= 60
    if (type && score >= 60) {
      const atr = this.calculateATR();
      const stopDistance = atr * 1.5;
      const tpMultiplier = type === 'LONG' ? 1 : -1;

      return {
        type,
        entryPrice: price,
        stopLoss: type === 'LONG' ? price - stopDistance : price + stopDistance,
        takeProfit1: price + (stopDistance * 1.5 * tpMultiplier),
        takeProfit2: price + (stopDistance * 2.5 * tpMultiplier),
        takeProfit3: price + (stopDistance * 4 * tpMultiplier),
        score,
        reason: reasons.join(', '),
        timestamp: Date.now(),
      };
    }

    return null;
  }

  /**
   * Calcula EMA
   */
  private calculateEMA(data: number[], period: number): number {
    if (data.length < period) return data[data.length - 1];
    
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    
    for (let i = period; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    
    return ema;
  }

  /**
   * Calcula RSI
   */
  private calculateRSI(data: number[], period: number): number {
    if (data.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = data.length - period; i < data.length; i++) {
      const change = data[i] - data[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  /**
   * Calcula MACD
   */
  private calculateMACD(data: number[]): { macd: number; signal: number; histogram: number } {
    const ema12 = this.calculateEMA(data, 12);
    const ema26 = this.calculateEMA(data, 26);
    const macd = ema12 - ema26;
    
    // Simplificado: usar EMA9 do MACD como signal
    const signal = macd * 0.9; // Aproximação
    const histogram = macd - signal;
    
    return { macd, signal, histogram };
  }

  /**
   * Calcula ATR (Average True Range)
   */
  private calculateATR(period: number = 14): number {
    if (this.candles.length < period + 1) {
      // Fallback: usar 1% do preço
      const price = this.currentCandle?.close || 50000;
      return price * 0.01;
    }

    let atrSum = 0;
    const recentCandles = this.candles.slice(-period - 1);

    for (let i = 1; i < recentCandles.length; i++) {
      const current = recentCandles[i];
      const previous = recentCandles[i - 1];
      
      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      );
      atrSum += tr;
    }

    return atrSum / period;
  }

  /**
   * Registra callback para receber sinais
   */
  onSignal(callback: SignalCallback): () => void {
    this.callbacks.push(callback);
    
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index > -1) {
        this.callbacks.splice(index, 1);
      }
    };
  }

  /**
   * Obtém status atual
   */
  getStatus(): { running: boolean; candles: number; lastSignal: number } {
    return {
      running: this.isRunning,
      candles: this.candles.length,
      lastSignal: this.lastSignalTime,
    };
  }
}

// Instância singleton
export const serverSignalDetector = new ServerSignalDetector();
