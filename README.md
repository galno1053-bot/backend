# Galno Backend

Express + Socket.IO + Prisma for Galno Crash.

## Setup
```
pnpm install
```

## Env
Copy `.env.example` -> `.env` and fill:
```
DATABASE_URL=
JWT_SECRET=
PORT=4000
EVM_CHAIN=sepolia
SOLANA_CLUSTER=devnet
EVM_RPC_URL=
SOLANA_RPC_URL=
EVM_ESCROW_ADDRESS=
EVM_ESCROW_OWNER_PRIVATE_KEY=
SOLANA_ESCROW_PROGRAM_ID=
SOLANA_ESCROW_AUTHORITY_KEY=
EVM_CONFIRMATIONS=1
SOLANA_CONFIRMATIONS=1
```

## Prisma
```
pnpm db:migrate
pnpm db:generate
```

## Dev
```
pnpm dev
```

## Contracts
- EVM escrow: `contracts/evm/GalnoEscrow.sol`
- Solana program: `programs/solana`

Deploy contracts/programs and set env vars.
