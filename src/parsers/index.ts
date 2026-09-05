import { BankSource, ParsedTransaction } from './types';
import { parseHdfcSms } from './hdfc';
import { parseGpay } from './gpay';

export function parseSms(bankSource: BankSource, raw: string): ParsedTransaction {
  switch (bankSource) {
    case 'hdfc':
      return parseHdfcSms(raw);
    case 'gpay':
      return parseGpay(raw);
    default:
      // Should be unreachable given the BankSource union, but keeps the
      // dispatcher safe if it's ever called with an unexpected value.
      return {
        amount: null,
        merchant: null,
        occurredAt: null,
        raw,
        parseSucceeded: false,
      };
  }
}

export * from './types';
