import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('system_counters')
export class SystemCounter {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  key: string;

  @Column({ type: 'integer', default: 1 })
  value: number;
}
