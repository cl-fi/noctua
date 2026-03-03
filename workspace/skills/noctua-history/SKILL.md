---
name: noctua-history
description: View past protection operations and Walrus audit trails
emoji: "📜"
user-invocable: true
requires:
  bins: ["node"]
---

# Noctua History

View past protection operations and verify audit trails on Walrus.

## Commands

### View recent operations
```bash
cd /path/to/noctua && node dist/cli.js history --count 10
```
Shows recent unwind operations with HF changes, amounts, TX digests, and Walrus blob IDs.

### Read Walrus audit trace
```bash
cd /path/to/noctua && node dist/cli.js trace <blobId>
```
Fetches and displays the full audit trace from Walrus decentralized storage. This data is immutable and tamper-proof.

## Usage Notes
- Each unwind operation generates a Walrus blob containing the full trace
- Traces include: trigger HF, restored HF, collateral sold, debt repaid, swap route, TX digest, gas used
- Walrus blobs persist across device changes — your audit trail survives everything
