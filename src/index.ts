import { loadConfig } from './config';
import { PolymarketClient, MarketInfo } from './polymarketClient';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class SniperBot {
  private config = loadConfig();
  private client = new PolymarketClient(this.config);
  private tradedEpochs: Set<number> = new Set();
  private currentMarket: MarketInfo | null = null;
  private currentEpoch: number = 0;
  private yesAsk: number = 0;
  private noAsk: number = 0;

  async start(): Promise<void> {
    console.log('');
    console.log('🎯 ═══════════════════════════════════════════');
    console.log('   BTC 5-MIN SNIPER BOT');
    console.log('═══════════════════════════════════════════════');
    console.log(`  Mode:         ${this.config.dryRun ? '🧪 DRY RUN' : '💰 LIVE'}`);
    console.log(`  Trade size:   $${this.config.tradeSizeUsd}`);
    console.log(`  Prices:       ${this.config.targetPrices.map((p) => (p * 100).toFixed(0) + '¢').join(', ')}`);
    console.log(`  Entry window: last ${this.config.entrySecondsBeforeExpiry}s`);
    console.log('═══════════════════════════════════════════════');
    console.log('');

    await this.client.initialize();

    while (true) {
      await this.runEpoch();
    }
  }

  private async runEpoch(): Promise<void> {
    const epoch = PolymarketClient.getCurrentEpoch();
    const secondsRemaining = PolymarketClient.getSecondsRemaining();

    if (this.tradedEpochs.has(epoch)) {
      await sleep(secondsRemaining * 1000 + 1000);
      return;
    }

    if (epoch !== this.currentEpoch) {
      this.currentEpoch = epoch;
      this.yesAsk = 0;
      this.noAsk = 0;

      this.currentMarket = await this.client.fetchMarket(epoch);
      if (!this.currentMarket || this.currentMarket.closed) {
        console.log(`[${this.timeStr()}] No market for epoch ${epoch}, skipping...`);
        await sleep(secondsRemaining * 1000 + 1000);
        return;
      }

      console.log(`[${this.timeStr()}] 📡 Epoch ${epoch} | ${this.currentMarket.question}`);

      this.client.connectWebSocket(
        [this.currentMarket.yesTokenId, this.currentMarket.noTokenId],
        (tokenId, bestAsk) => this.onPriceUpdate(tokenId, bestAsk)
      );
    }

    if (secondsRemaining > this.config.entrySecondsBeforeExpiry) {
      const waitTime = secondsRemaining - this.config.entrySecondsBeforeExpiry;
      console.log(`[${this.timeStr()}] ⏳ ${secondsRemaining}s left — sleeping ${waitTime}s until snipe window`);
      await sleep(waitTime * 1000);
      return;
    }

    const yesStr = this.yesAsk > 0 ? `${(this.yesAsk * 100).toFixed(1)}¢` : '...';
    const noStr = this.noAsk > 0 ? `${(this.noAsk * 100).toFixed(1)}¢` : '...';
    console.log(`[${this.timeStr()}] 🎯 SNIPE WINDOW | ${secondsRemaining}s left | YES: ${yesStr} | NO: ${noStr}`);

    await sleep(2000);
  }

  private async onPriceUpdate(tokenId: string, bestAsk: number): Promise<void> {
    if (!this.currentMarket) return;

    if (tokenId === this.currentMarket.yesTokenId) {
      this.yesAsk = bestAsk;
    } else if (tokenId === this.currentMarket.noTokenId) {
      this.noAsk = bestAsk;
    }

    const secondsRemaining = PolymarketClient.getSecondsRemaining();
    if (secondsRemaining > this.config.entrySecondsBeforeExpiry) return;
    if (secondsRemaining < this.config.minSecondsBeforeExpiry) return;

    if (this.tradedEpochs.has(this.currentEpoch)) return;

    const matchedPrice = this.config.targetPrices.find(
      (target) => bestAsk >= target - 0.005 && bestAsk <= target + 0.005
    );

    if (!matchedPrice) return;

    let side: 'YES' | 'NO';
    let buyTokenId: string;

    if (tokenId === this.currentMarket.yesTokenId) {
      side = 'YES';
      buyTokenId = this.currentMarket.yesTokenId;
    } else {
      side = 'NO';
      buyTokenId = this.currentMarket.noTokenId;
    }

    this.tradedEpochs.add(this.currentEpoch);

    console.log('');
    console.log(`🎯 ════════════════════════════════════════════`);
    console.log(`   SNIPING: ${side} @ ${(bestAsk * 100).toFixed(1)}¢`);
    console.log(`   ${secondsRemaining}s before expiry`);
    console.log(`   Market: ${this.currentMarket.question}`);
    console.log(`════════════════════════════════════════════════`);

    const result = await this.client.placeBuyOrder(buyTokenId, bestAsk, side);
    console.log("result", result);

    if (result.success) {
      console.log(`   ✅ ORDER PLACED — ID: ${result.orderId}`);
    } else {
      console.log(`   ❌ ORDER FAILED — ${result.error}`);
    }
    console.log('');
  }

  private timeStr(): string {
    return new Date().toLocaleTimeString('en-IN', { hour12: false });
  }
}

const bot = new SniperBot();

process.on('SIGINT', () => {
  console.log('\n🛑 Bot stopped');
  process.exit(0);
});

bot.start().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
