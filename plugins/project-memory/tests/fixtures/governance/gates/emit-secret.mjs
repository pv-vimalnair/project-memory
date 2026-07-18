const secret = process.env.GATE_SECRET ?? "missing";
process.stdout.write(`api_key=${secret}\n`);
