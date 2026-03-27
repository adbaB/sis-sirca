export class PaymentRegisteredEvent {
  constructor(
    public readonly reference: string,
    public readonly amountUsd: number,
    public readonly amountVes: number,
    public readonly receiptUrl: string | undefined | null,
    public readonly createdAt: Date,
  ) {}
}
