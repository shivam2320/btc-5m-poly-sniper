/**
 * Claim script: redeem winnings for all past trades (resolved markets).
 * Fetches redeemable positions from Polymarket Data API and calls CTF.redeemPositions for each.
 */
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import axios from 'axios';

dotenv.config();

const DATA_API = 'https://data-api.polymarket.com';
const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const USDC_E = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const PARENT_COLLECTION_ID = '0x0000000000000000000000000000000000000000000000000000000000000000';
const BINARY_INDEX_SETS = [1, 2]; // Yes = 1, No = 2

// Polygon requires min ~25 gwei priority fee; use 30 for headroom (override with GAS_TIP_GWEI env)
const DEFAULT_GAS_TIP_GWEI = 30;
// Fallback max when chain base fee unavailable (must be above typical Polygon base, e.g. 100+ gwei)
const FALLBACK_MAX_FEE_GWEI = 150;

const CTF_ABI = [
  'function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets) external',
];

interface PositionRow {
  conditionId?: string;
  asset?: string;
  size?: number;
  redeemable?: boolean;
  title?: string;
  outcome?: string;
  [key: string]: unknown;
}

async function getRedeemableConditionIds(userAddress: string): Promise<{ conditionId: string; title?: string; size?: number }[]> {
  const seen = new Set<string>();
  const out: { conditionId: string; title?: string; size?: number }[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const { data: raw } = await axios.get<PositionRow[] | { positions?: PositionRow[] }>(`${DATA_API}/positions`, {
      params: { user: userAddress, redeemable: true, limit, offset },
      timeout: 15000,
    });
    const data = Array.isArray(raw) ? raw : (raw?.positions ?? []);
    if (data.length === 0) break;
    for (const row of data) {
      const cid = row.conditionId;
      if (cid && !seen.has(cid)) {
        seen.add(cid);
        out.push({
          conditionId: cid,
          title: row.title as string | undefined,
          size: row.size as number | undefined,
        });
      }
    }
    if (data.length < limit) break;
    offset += limit;
  }
  return out;
}

async function main(): Promise<void> {
  const privateKey = process.env.POLYMARKET_PRIVATE_KEY;
  if (!privateKey) {
    console.error('Missing POLYMARKET_PRIVATE_KEY in .env');
    process.exit(1);
  }

  const dryRun = process.env.DRY_RUN === 'true';
  const rpcUrl = process.env.POLYGON_RPC_URL;
  const provider = rpcUrl
    ? new ethers.providers.JsonRpcProvider(rpcUrl)
    : ethers.getDefaultProvider('matic');
  const wallet = new ethers.Wallet(privateKey, provider);
  const address = wallet.address;

  console.log('');
  console.log('💰 Claim all past trades (redeem winnings)');
  console.log('   Wallet:', address);
  console.log('   Mode:', dryRun ? 'DRY RUN (no tx)' : 'LIVE');
  console.log('');

  const positions = await getRedeemableConditionIds(address);
  if (positions.length === 0) {
    console.log('   No redeemable positions found.');
    console.log('');
    return;
  }

  console.log(`   Found ${positions.length} redeemable condition(s):`);
  for (const p of positions) {
    console.log(`   - ${p.conditionId} ${p.title ? `(${p.title})` : ''} ${p.size != null ? `size: ${p.size}` : ''}`);
  }
  console.log('');

  const ctf = new ethers.Contract(CTF_ADDRESS, CTF_ABI, wallet);
  const tipGwei = parseInt(process.env.GAS_TIP_GWEI || '', 10) || DEFAULT_GAS_TIP_GWEI;
  const maxPriorityFeePerGas = ethers.utils.parseUnits(String(tipGwei), 'gwei');

  let maxFeePerGas: ethers.BigNumber;
  const envMaxGwei = parseInt(process.env.GAS_MAX_FEE_GWEI || '', 10);
  if (envMaxGwei > 0) {
    maxFeePerGas = ethers.utils.parseUnits(String(envMaxGwei), 'gwei');
  } else {
    const feeData = await provider.getFeeData();
    const baseFee = feeData.lastBaseFeePerGas ?? ethers.utils.parseUnits('100', 'gwei');
    // maxFeePerGas must be >= block base fee. Use base + tip with 20% buffer for next block.
    maxFeePerGas = baseFee.mul(120).div(100).add(maxPriorityFeePerGas);
    const fallback = ethers.utils.parseUnits(String(FALLBACK_MAX_FEE_GWEI), 'gwei');
    if (maxFeePerGas.lt(fallback)) maxFeePerGas = fallback;
  }

  const gasOverrides = { maxPriorityFeePerGas, maxFeePerGas };
  if (!dryRun) {
    console.log(`   Gas: tip ${tipGwei} gwei, maxFee ${ethers.utils.formatUnits(maxFeePerGas, 'gwei')} gwei (GAS_TIP_GWEI / GAS_MAX_FEE_GWEI to override)`);
  }
  console.log('');

  for (const { conditionId, title } of positions) {
    const hexConditionId = conditionId.startsWith('0x') ? conditionId : `0x${conditionId}`;
    const conditionIdBytes32 = ethers.utils.hexZeroPad(hexConditionId, 32);
    if (dryRun) {
      console.log(`   [DRY RUN] Would redeem conditionId=${conditionId} ${title ? `(${title})` : ''}`);
      continue;
    }
    try {
      const tx = await ctf.redeemPositions(
        USDC_E,
        PARENT_COLLECTION_ID,
        conditionIdBytes32,
        BINARY_INDEX_SETS,
        gasOverrides
      );
      console.log(`   Tx sent: ${conditionId.slice(0, 18)}... -> ${tx.hash}`);
      await tx.wait();
      console.log(`   ✅ Confirmed: ${tx.hash}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`   ❌ Failed ${conditionId}: ${msg}`);
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
