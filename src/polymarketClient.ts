import { ClobClient, Side, ApiKeyCreds } from '@polymarket/clob-client';
import { Wallet } from '@ethersproject/wallet';
import { Config } from './config';
import axios from 'axios';
import WebSocket from 'ws';

export interface MarketInfo {
  conditionId: string;
  question: string;
  yesTokenId: string;
  noTokenId: string;
  endDate: string;
  epoch: number;
  closed: boolean;
}

export interface OrderResult {
  success: boolean;
  orderId?: string;
  error?: string;
  side: 'YES' | 'NO';
  price: number;
}

type PriceCallback = (tokenId: string, bestAsk: number) => void;

const EPOCH_DURATION = 300;
const WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

export class PolymarketClient {
  private clobClient: ClobClient;
  private config: Config;
  private apiCreds: ApiKeyCreds | null = null;
  private initialized: boolean = false;
  private signer: Wallet;
  private ws: WebSocket | null = null;
  private subscribedTokens: string[] = [];
  private onPrice: PriceCallback | null = null;

  constructor(config: Config) {
    this.config = config;
    this.signer = new Wallet(config.polymarketPrivateKey);
    this.clobClient = new ClobClient(
      'https://clob.polymarket.com',
      137,
      this.signer
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      let rawCreds: any;
      try {
        rawCreds = await this.clobClient.deriveApiKey();
      } catch {
        rawCreds = await this.clobClient.createApiKey();
      }

      this.apiCreds = {
        key: rawCreds.apiKey || rawCreds.key,
        secret: rawCreds.secret,
        passphrase: rawCreds.passphrase,
      };

      this.clobClient = new ClobClient(
        'https://clob.polymarket.com',
        137,
        this.signer,
        this.apiCreds,
        0,
        this.signer.address
      );

      this.initialized = true;
      console.log('✅ CLOB client initialized');
    } catch (error) {
      throw new Error(`Failed to initialize: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  static getCurrentEpoch(): number {
    const now = Math.floor(Date.now() / 1000);
    return Math.floor(now / EPOCH_DURATION) * EPOCH_DURATION;
  }

  static getSecondsRemaining(): number {
    const now = Math.floor(Date.now() / 1000);
    const endTime = Math.floor(now / EPOCH_DURATION) * EPOCH_DURATION + EPOCH_DURATION;
    return endTime - now;
  }

  async fetchMarket(epoch: number): Promise<MarketInfo | null> {
    try {
      const slug = `btc-updown-5m-${epoch}`;
      const response = await axios.get(
        `https://gamma-api.polymarket.com/markets/slug/${slug}`,
        { timeout: 10000 }
      );
      const market = response.data;

      let clobTokenIds: string[] = [];
      if (typeof market.clobTokenIds === 'string') {
        clobTokenIds = JSON.parse(market.clobTokenIds);
      } else if (Array.isArray(market.clobTokenIds)) {
        clobTokenIds = market.clobTokenIds;
      }

      if (clobTokenIds.length < 2) return null;

      return {
        conditionId: market.conditionId || market.id || '',
        question: market.question || '',
        yesTokenId: clobTokenIds[0],
        noTokenId: clobTokenIds[1],
        endDate: market.endDate || market.endDateIso || '',
        epoch,
        closed: market.closed === true,
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) return null;
      console.error(`Failed to fetch market:`, error instanceof Error ? error.message : error);
      return null;
    }
  }

  async placeBuyOrder(tokenId: string, price: number, side: 'YES' | 'NO'): Promise<OrderResult> {
    try {
      if (!this.initialized) await this.initialize();

      const secondsLeft = PolymarketClient.getSecondsRemaining();
      if (secondsLeft > 60 || secondsLeft < 10) {
        return {
          success: false,
          error: `Outside time window (${secondsLeft}s remaining, need 10-60s)`,
          side,
          price,
        };
      }

      const minAmount = Math.max(this.config.tradeSizeUsd, 1);
      const size = Math.ceil((minAmount / price) * 100) / 100;

      if (this.config.dryRun) {
        console.log(`  🧪 [DRY RUN] Would buy ${side} @ ${(price * 100).toFixed(0)}¢ — ${size.toFixed(1)} shares ($${this.config.tradeSizeUsd})`);
        return { success: true, orderId: `dry-${Date.now()}`, side, price };
      }

      const signedOrder = await this.clobClient.createOrder({
        tokenID: tokenId,
        price,
        size,
        side: Side.BUY,
        feeRateBps: 1000,
      });

      const orderResponse = await this.clobClient.postOrder(signedOrder);
      console.log("orderResponse", orderResponse);

      return {
        success: true,
        orderId: orderResponse.orderID || orderResponse.id || signedOrder.salt || `order-${Date.now()}`,
        side,
        price,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        side,
        price,
      };
    }
  }

  connectWebSocket(tokenIds: string[], callback: PriceCallback): void {
    this.onPrice = callback;
    this.subscribedTokens = tokenIds;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendSubscription(tokenIds);
      return;
    }

    console.log(`[WS] Connecting...`);
    this.ws = new WebSocket(WS_URL);

    this.ws.on('open', () => {
      console.log(`[WS] ✅ Connected`);
      this.sendSubscription(this.subscribedTokens);
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      const msg = data.toString();
      if (msg === 'PONG' || msg === 'PING' || msg.trim() === '') return;

      try {
        const parsed = JSON.parse(msg);
        if (parsed.event_type === 'price_change' && parsed.price_changes) {
          for (const pc of parsed.price_changes) {
            if (this.subscribedTokens.includes(pc.asset_id) && pc.best_ask) {
              const bestAsk = parseFloat(pc.best_ask);
              if (this.onPrice) {
                this.onPrice(pc.asset_id, bestAsk);
              }
            }
          }
        }
      } catch {
      }
    });

    this.ws.on('close', () => {
      console.log(`[WS] Disconnected — reconnecting in 2s...`);
      setTimeout(() => {
        if (this.subscribedTokens.length > 0) {
          this.connectWebSocket(this.subscribedTokens, this.onPrice!);
        }
      }, 2000);
    });

    this.ws.on('error', (err) => {
      console.error(`[WS] Error:`, err.message);
    });
  }

  private sendSubscription(tokenIds: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'MARKET',
      assets_ids: tokenIds,
      event_type: 'book',
    }));
    console.log(`[WS] Subscribed to ${tokenIds.length} tokens`);
  }
}
