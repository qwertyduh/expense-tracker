import { BankSource, ParsedTransaction } from './types';
import { parseHdfcSms } from './hdfc';
import { parseGpay } from './gpay';
import { parseFamAppSms } from './fampapp';
import { parseAnySms } from './sms';

export function parseSms(bankSource: BankSource, raw: string): ParsedTransaction {
  switch (bankSource) {
    case 'hdfc':
      return parseHdfcSms(raw);
    case 'gpay':
      return parseGpay(raw);
    case 'fampapp':
      return parseFamAppSms(raw);
    default:
      return {
        amount: null,
        merchant: null,
        occurredAt: null,
        raw,
        parseSucceeded: false,
      };
  }
}

export { parseAnySms };
export * from './types';