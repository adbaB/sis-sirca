export class SurplusCreatedEvent {
  constructor(
    public readonly reference: string,
    public readonly amountUsd: number | null,
    public readonly amountVes: number | null,
    public readonly receiptUrl: string | undefined | null,
    public readonly date: Date,
    public readonly contractCode: string,
  ) {}
}
