import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('payment_types')
export class PaymentType {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 10 })
  currency: string;
}
