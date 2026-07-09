const args = process.argv.slice(2);
let amount: number | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--amount" && args[i + 1]) {
    amount = Number.parseInt(args[i + 1], 10);
  }
}

const base = process.env.HARBOR_API ?? "http://127.0.0.1:3001";
const res = await fetch(`${base}/api/demo/simulate`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(amount ? { amountSats: amount, confirmations: 1 } : { confirmations: 1 }),
});

if (!res.ok) {
  console.error(await res.text());
  process.exit(1);
}

const body = (await res.json()) as {
  address: string;
  amountSats: number;
  txid: string;
  confirmations: number;
};

console.log("Simulated donation:");
console.log(`  amount:  ${body.amountSats.toLocaleString()} sats`);
console.log(`  address: ${body.address}`);
console.log(`  txid:    ${body.txid}`);
console.log(`  confs:   ${body.confirmations}`);
console.log("\nOpen http://localhost:5173/dashboard to see it.");
