# Polymarket Trading Bot

A low-latency TypeScript trading bot for Polymarket BTC markets that places trades in the last 3 minutes before market expiry.

## Features

- **Polymarket Integration**: Uses CLOB client and Gamma API for market data
- **Real-time Orderbook**: WebSocket connection for live bid/ask price updates
- **PostgreSQL Storage**: Stores bid/ask prices in PostgreSQL database
- **Smart Trading Logic**: Evaluates YES/NO sides independently and trades when price >= 0.98
- **Safety Mechanisms**: 
  - Never places duplicate trades per market
  - Aborts if time remaining < 5 seconds
  - Aborts if order latency exceeds 1 second
- **Comprehensive Logging**: Logs all market evaluations and trade results

## Requirements

- Node.js 18+ 
- pnpm
- PostgreSQL database
- Ethereum wallet private key (for signing transactions)

## Installation

1. Clone the repository and install dependencies:

```bash
pnpm install
```

2. Set up PostgreSQL database:

```bash
# Create database
createdb polymarket_bot

# Or using psql
psql -U postgres
CREATE DATABASE polymarket_bot;
```

3. Copy the example environment file:

```bash
cp env.example .env
```

4. Configure your environment variables in `.env`:

```env
POLYMARKET_PRIVATE_KEY=0x_your_wallet_private_key_here
START_EPOCH=1766498400
DATABASE_URL=postgresql://user:password@localhost:5432/polymarket_bot
TRADE_SIZE_USD=10
POLL_INTERVAL_MS=5000
```

## Usage

### Development Mode

```bash
pnpm dev
```

### Production Mode

Build and run:

```bash
pnpm build
pnpm start
```

### Watch Mode (for development)

```bash
pnpm watch
```

## Architecture

The bot consists of the following modules:

- **`config.ts`**: Loads and validates environment variables
- **`polymarketClient.ts`**: Uses Polymarket CLOB client for order placement and Gamma API for market data
- **`priceDatabase.ts`**: PostgreSQL database interface for storing bid/ask prices
- **`orderbookWebSocket.ts`**: WebSocket client for real-time orderbook updates
- **`marketScanner.ts`**: Scans markets and evaluates trading opportunities
- **`tradeExecutor.ts`**: Executes trades with safety checks
- **`index.ts`**: Main entry point that orchestrates the polling loop

## Database Schema

The bot automatically creates the following table:

```sql
CREATE TABLE market_bid_ask (
  epoch BIGINT NOT NULL,
  token_id VARCHAR(255) NOT NULL,
  best_bid NUMERIC(20, 8),
  best_ask NUMERIC(20, 8),
  timestamp BIGINT NOT NULL,
  PRIMARY KEY (epoch, token_id)
);
```

## Trading Logic

The bot evaluates each market independently:

1. **YES Trade Conditions**:
   - `yes_price >= 0.98`
   - `time_remaining <= 180 seconds` (3 minutes)
   - Market status is `open`

2. **NO Trade Conditions**:
   - `no_price >= 0.98`
   - `time_remaining <= 180 seconds` (3 minutes)
   - Market status is `open`

3. **Decision Logic**:
   - If both sides meet conditions, chooses the side with higher price
   - Places buy order at current market price
   - Never trades the same market twice

## Safety Features

- **Idempotency**: Tracks traded market IDs in memory to prevent duplicate trades
- **Time Checks**: Aborts trades if time remaining < 5 seconds
- **Latency Monitoring**: Aborts if order placement latency exceeds 1 second
- **Market Status**: Only trades in open markets

## Logging

The bot logs:
- Market scan results (YES/NO prices, time remaining)
- Trading decisions (YES/NO/SKIP) with reasons
- Order execution results (success/failure, order IDs, latency)
- WebSocket connection status
- Database operations

## Notes

- The bot uses polling (not websockets for trading decisions) as specified
- All timing-sensitive operations are marked with inline comments
- The bot gracefully handles API failures and reconnects WebSocket automatically
- Trading decisions are based on real-time orderbook data stored in PostgreSQL
- SIGINT/SIGTERM signals are handled for graceful shutdown
- Database schema is automatically created on first run

## License

MIT
