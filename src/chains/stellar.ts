export async function checkStellarRecipientReady(
  recipient: string,
  network: Network = "mainnet",
  rpcUrl?: string,
): Promise<StellarRecipientStatus> {
  const stellar = stellarConfig(network);
  const server = getServer(network, rpcUrl);

  let account;
  try {
    account = await server.getAccount(recipient);
  } catch (e) {
    // Distinguish account-not-found from infrastructure failures
    if (e instanceof Error && e.message.includes("Account not found")) {
      return { exists: false, hasTrustline: false, ready: false };
    }
    throw e; // Propagate RPC/transport errors
  }

  // Existing trustline check logic remains unchanged
  let hasTrustline = false;
  try {
    const usdcAsset = `${stellar.usdc}:${stellar.tokenMessengerMinter}`;
    await server.prepareTransaction(
      new TransactionBuilder(account, {
        fee: "100", // Minimal fee for simulation
        networkPassphrase: stellarConfig(network).networkPassphrase,
      })
        .addOperation(
          Operation.payment({
            destination: recipient,
            asset: new Asset(usdcAsset.split(":")[0], usdcAsset.split(":")[1]),
            amount: "0.0000001", // Minimal amount to trigger trustline check
          })
        )
        .build()
    );
    hasTrustline = true;
  } catch (e) {
    if (e instanceof Error && e.message.includes(MISSING_TRUSTLINE_MESSAGE)) {
      hasTrustline = false;
    } else {
      throw e; // Propagate unexpected simulation errors
    }
  }

  return {
    exists: true,
    hasTrustline,
    ready: hasTrustline,
  };
}
