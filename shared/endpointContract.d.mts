export interface ContractRequest {
  upstream: 'usaspending' | 'fiscaldata';
  sourceId: string;
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
}

export interface EndpointCheck {
  name: string;
  request: ContractRequest;
  rowsAt: (json: any) => unknown;
  /** purpose → ordered candidate field names the app will try. */
  expect: Record<string, string[]>;
}

export interface FieldResolution {
  resolved: Record<string, string>;
  missing: { purpose: string; candidates: string[] }[];
}

export declare const GOV_HOSTS: Record<'usaspending' | 'fiscaldata', string>;
export declare function currentFiscalYear(now?: Date): number;
export declare function buildChecks(lastCompleteFy?: number): EndpointCheck[];
export declare function resolveFields(
  sample: Record<string, unknown>,
  expect: Record<string, string[]>,
): FieldResolution;
