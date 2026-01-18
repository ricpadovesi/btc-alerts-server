/**
 * Serviço de Execução de Ordens Binance no Servidor
 * 
 * Executa ordens na Binance Futures quando sinais são detectados.
 * Roda 24/7 no servidor, independente do app estar aberto.
 */

import crypto from 'crypto';

interface BinanceConfig {
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
}

interface OrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
  executedQty?: number;
  avgPrice?: number;
}

interface Position {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  unRealizedProfit: string;
  leverage: string;
  marginType: string;
}

class ServerBinanceExecutor {
  private config: BinanceConfig | null = null;
  private baseUrl: string = '';

  /**
   * Configura as credenciais da Binance
   */
  configure(config: BinanceConfig): void {
    this.config = config;
    this.baseUrl = config.testnet
      ? 'https://testnet.binancefuture.com'
      : 'https://fapi.binance.com';
    
    console.log(`[BinanceExecutor] Configurado para ${config.testnet ? 'TESTNET' : 'PRODUÇÃO'}`);
  }

  /**
   * Verifica se está configurado
   */
  isConfigured(): boolean {
    return this.config !== null && !!this.config.apiKey && !!this.config.apiSecret;
  }

  /**
   * Gera assinatura HMAC SHA256
   */
  private sign(queryString: string): string {
    if (!this.config) throw new Error('Binance não configurada');
    return crypto
      .createHmac('sha256', this.config.apiSecret)
      .update(queryString)
      .digest('hex');
  }

  /**
   * Faz requisição autenticada para a Binance
   */
  private async request(
    method: 'GET' | 'POST' | 'DELETE',
    endpoint: string,
    params: Record<string, string | number> = {}
  ): Promise<any> {
    if (!this.config) throw new Error('Binance não configurada');

    const timestamp = Date.now();
    const queryParams = { ...params, timestamp };
    const queryString = Object.entries(queryParams)
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    
    const signature = this.sign(queryString);
    const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`;

    const response = await fetch(url, {
      method,
      headers: {
        'X-MBX-APIKEY': this.config.apiKey,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.msg || `HTTP ${response.status}`);
    }

    return data;
  }

  /**
   * Define alavancagem
   */
  async setLeverage(symbol: string, leverage: number): Promise<boolean> {
    try {
      await this.request('POST', '/fapi/v1/leverage', {
        symbol,
        leverage,
      });
      console.log(`[BinanceExecutor] Alavancagem definida: ${leverage}x`);
      return true;
    } catch (error: any) {
      // Erro -4028 significa que a alavancagem já está definida
      if (error.message?.includes('-4028')) {
        return true;
      }
      console.error('[BinanceExecutor] Erro ao definir alavancagem:', error.message);
      return false;
    }
  }

  /**
   * Define modo de margem (ISOLATED ou CROSSED)
   */
  async setMarginType(symbol: string, marginType: 'ISOLATED' | 'CROSSED'): Promise<boolean> {
    try {
      await this.request('POST', '/fapi/v1/marginType', {
        symbol,
        marginType,
      });
      console.log(`[BinanceExecutor] Modo de margem definido: ${marginType}`);
      return true;
    } catch (error: any) {
      // Erro -4046 significa que o modo já está definido
      if (error.message?.includes('-4046')) {
        return true;
      }
      console.error('[BinanceExecutor] Erro ao definir modo de margem:', error.message);
      return false;
    }
  }

  /**
   * Obtém saldo disponível
   */
  async getBalance(): Promise<number> {
    try {
      const data = await this.request('GET', '/fapi/v2/balance');
      const usdtBalance = data.find((b: any) => b.asset === 'USDT');
      return parseFloat(usdtBalance?.availableBalance || '0');
    } catch (error: any) {
      console.error('[BinanceExecutor] Erro ao obter saldo:', error.message);
      return 0;
    }
  }

  /**
   * Obtém posições abertas
   */
  async getOpenPositions(): Promise<Position[]> {
    try {
      const data = await this.request('GET', '/fapi/v2/positionRisk');
      return data.filter((p: Position) => parseFloat(p.positionAmt) !== 0);
    } catch (error: any) {
      console.error('[BinanceExecutor] Erro ao obter posições:', error.message);
      return [];
    }
  }

  /**
   * Calcula tamanho da posição
   */
  async calculatePositionSize(
    accountPercentage: number,
    entryPrice: number,
    leverage: number
  ): Promise<number> {
    const balance = await this.getBalance();
    const positionValue = balance * (accountPercentage / 100);
    const leveragedValue = positionValue * leverage;
    const quantity = leveragedValue / entryPrice;
    
    // Arredondar para 3 casas decimais (precisão do BTC)
    return Math.floor(quantity * 1000) / 1000;
  }

  /**
   * Abre ordem de mercado
   */
  async openMarketOrder(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number
  ): Promise<OrderResult> {
    try {
      console.log(`[BinanceExecutor] Abrindo ordem: ${side} ${quantity} ${symbol}`);
      
      const data = await this.request('POST', '/fapi/v1/order', {
        symbol,
        side,
        type: 'MARKET',
        quantity: quantity.toFixed(3),
      });

      console.log(`[BinanceExecutor] ✅ Ordem executada: ${data.orderId}`);
      
      return {
        success: true,
        orderId: data.orderId.toString(),
        executedQty: parseFloat(data.executedQty),
        avgPrice: parseFloat(data.avgPrice),
      };
    } catch (error: any) {
      console.error('[BinanceExecutor] ❌ Erro ao abrir ordem:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Fecha posição
   */
  async closePosition(symbol: string): Promise<OrderResult> {
    try {
      const positions = await this.getOpenPositions();
      const position = positions.find(p => p.symbol === symbol);
      
      if (!position) {
        return { success: false, error: 'Posição não encontrada' };
      }

      const positionAmt = parseFloat(position.positionAmt);
      const side = positionAmt > 0 ? 'SELL' : 'BUY';
      const quantity = Math.abs(positionAmt);

      return await this.openMarketOrder(symbol, side, quantity);
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Executa sinal de trading
   */
  async executeSignal(signal: {
    type: 'LONG' | 'SHORT';
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    accountPercentage: number;
    leverage: number;
  }): Promise<OrderResult> {
    try {
      const symbol = 'BTCUSDT';
      
      // Verificar se já existe posição aberta
      const positions = await this.getOpenPositions();
      const existingPosition = positions.find(p => p.symbol === symbol);
      
      if (existingPosition) {
        console.log('[BinanceExecutor] ⚠️ Já existe posição aberta, ignorando sinal');
        return { success: false, error: 'Posição já aberta' };
      }

      // Configurar alavancagem e margem
      await this.setLeverage(symbol, signal.leverage);
      await this.setMarginType(symbol, 'ISOLATED');

      // Calcular tamanho da posição
      const quantity = await this.calculatePositionSize(
        signal.accountPercentage,
        signal.entryPrice,
        signal.leverage
      );

      if (quantity <= 0) {
        return { success: false, error: 'Quantidade inválida' };
      }

      // Abrir ordem
      const side = signal.type === 'LONG' ? 'BUY' : 'SELL';
      const result = await this.openMarketOrder(symbol, side, quantity);

      return result;
    } catch (error: any) {
      console.error('[BinanceExecutor] Erro ao executar sinal:', error.message);
      return { success: false, error: error.message };
    }
  }
}

// Instância singleton
export const serverBinanceExecutor = new ServerBinanceExecutor();
