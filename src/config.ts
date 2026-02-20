import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  polymarketPrivateKey: string;
  tradeSizeUsd: number;
  targetPrices: number[];
  entrySecondsBeforeExpiry: number;
  minSecondsBeforeExpiry: number;
  dryRun: boolean;
}

export function loadConfig(): Config {
  const polymarketPrivateKey = process.env.POLYMARKET_PRIVATE_KEY;
  const tradeSizeUsd = parseFloat(process.env.TRADE_SIZE_USD || '5');
  const dryRun = process.env.DRY_RUN === 'true';

  const targetPricesStr = process.env.TARGET_PRICES || '0.07,0.08,0.09,0.10';
  const targetPrices = targetPricesStr.split(',').map((p) => parseFloat(p.trim()));

  const entrySecondsBeforeExpiry = parseInt(process.env.ENTRY_SECONDS_BEFORE_EXPIRY || '60', 10);
  const minSecondsBeforeExpiry = parseInt(process.env.MIN_SECONDS_BEFORE_EXPIRY || '5', 10);

  if (!polymarketPrivateKey) {
    throw new Error('POLYMARKET_PRIVATE_KEY environment variable is required');
  }

  if (tradeSizeUsd <= 0) {
    throw new Error('TRADE_SIZE_USD must be greater than 0');
  }

  return {
    polymarketPrivateKey,
    tradeSizeUsd,
    targetPrices,
    entrySecondsBeforeExpiry,
    minSecondsBeforeExpiry,
    dryRun,
  };
}
