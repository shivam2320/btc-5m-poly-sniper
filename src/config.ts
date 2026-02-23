import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  polymarketPrivateKey: string;
  safeAddress: string;
  tradeShareSize: number;
  targetPrices: number[];
  entrySecondsBeforeExpiry: number;
  minSecondsBeforeExpiry: number;
  dryRun: boolean;
}

export function loadConfig(): Config {
  const polymarketPrivateKey = process.env.POLYMARKET_PRIVATE_KEY;
  const safeAddress = process.env.SAFE_ADDRESS;
  const tradeShareSize = parseFloat(process.env.TRADE_SHARE_SIZE || '10');
  const dryRun = process.env.DRY_RUN === 'true';

  const targetPricesStr = process.env.TARGET_PRICES || '0.07';
  const targetPrices = targetPricesStr.split(',').map((p) => parseFloat(p.trim()));

  const entrySecondsBeforeExpiry = parseInt(process.env.ENTRY_SECONDS_BEFORE_EXPIRY || '60', 10);
  const minSecondsBeforeExpiry = parseInt(process.env.MIN_SECONDS_BEFORE_EXPIRY || '5', 10);

  if (!polymarketPrivateKey) {
    throw new Error('POLYMARKET_PRIVATE_KEY environment variable is required');
  }

  if (!safeAddress) {
    throw new Error('SAFE_ADDRESS environment variable is required');
  }

  if (tradeShareSize <= 0) {
    throw new Error('TRADE_SHARE_SIZE must be greater than 0');
  }

  return {
    polymarketPrivateKey,
    safeAddress,
    tradeShareSize,
    targetPrices,
    entrySecondsBeforeExpiry,
    minSecondsBeforeExpiry,
    dryRun,
  };
}
