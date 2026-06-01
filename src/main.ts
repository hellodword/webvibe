#!/usr/bin/env node

export async function main(): Promise<void> {
  console.log("webvibe scaffold");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
