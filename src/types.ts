// Add maxFee and maxWait to EstimateFeeParams
export type EstimateFeeParams = {
  from: ChainId;
  to: ChainId;
  amount: string;
  speed: TransferMode;
  network?: Network;
  maxFee?: string;
  maxWait?: number;
};
