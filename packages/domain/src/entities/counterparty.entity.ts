import { isNonEmptyString } from './decimal-amount';
import { InvalidDebtError } from '../errors/invalid-debt.error';

/**
 * TASK-FIN-002 (Chapter 8 §8.3, §13.6 `counterparties`) — the person a debt
 * is given to or received from. Deliberately its own aggregate/entity
 * (mirrors the dedicated-repository precedent `ExpenseHistoryRepository`/
 * `ReportQueryRepository` already established: a distinct table, its own
 * lifecycle, not folded into `Debt`) — a `Counterparty` can exist and be
 * matched against before any `Debt` referencing it does.
 */
export interface CounterpartyProps {
  id: string;
  userId: string;
  name: string;
  aliases: readonly string[];
  createdAt: Date;
}

export class Counterparty {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly createdAt: Date;

  constructor(props: CounterpartyProps) {
    Counterparty.validate(props);
    this.id = props.id;
    this.userId = props.userId;
    this.name = props.name;
    this.aliases = props.aliases;
    this.createdAt = props.createdAt;
  }

  private static validate(props: CounterpartyProps): void {
    if (!isNonEmptyString(props.id)) {
      throw new InvalidDebtError('Counterparty id is required.');
    }
    if (!isNonEmptyString(props.userId)) {
      throw new InvalidDebtError('Counterparty userId is required.');
    }
    if (!isNonEmptyString(props.name)) {
      throw new InvalidDebtError('Counterparty name is required.');
    }
  }
}
