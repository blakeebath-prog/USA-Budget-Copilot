export interface UpstreamRequest {
  upstream: 'usaspending' | 'fiscaldata';
  sourceId: string;
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
}

export interface FiscalDataQuery {
  endpoint: string;
  filters?: string[];
  sort?: string[];
  pageSize?: number;
  pageNumber?: number;
}

export interface AwardSearchFilterInput {
  startDate: string;
  endDate: string;
  awardTypeCodes?: readonly string[];
  agencyToptierName?: string;
}

export declare const FISCAL_SERVICE_ROOT: string;
export declare const MTS_TABLE_1: string;
export declare const MTS_TABLE_4: string;
export declare const MTS_TABLE_5: string;
export declare const DEBT_TO_PENNY: string;

export declare function fiscalDataPath(query: FiscalDataQuery): string;
export declare function monthlyFlowsRequest(startDate: string): UpstreamRequest;
export declare function receiptsBySourceRequest(fiscalYear: number): UpstreamRequest;
export declare function outlaysByDepartmentRequest(fiscalYear: number): UpstreamRequest;
export declare function debtRequest(startDate: string): UpstreamRequest;
export declare function toptierAgenciesRequest(): UpstreamRequest;
export declare function agencyBudgetaryResourcesRequest(toptierCode: string): UpstreamRequest;
export declare function spendingExplorerRequest(query: {
  type: string;
  fiscalYear: number;
  quarter?: number;
  budgetFunction?: string;
  agency?: string;
}): UpstreamRequest;
export declare function searchFilters(filters: AwardSearchFilterInput): Record<string, unknown>;
export declare function spendingByCategoryRequest(
  category: string,
  filters: AwardSearchFilterInput,
  limit?: number,
): UpstreamRequest;
export declare function spendingOverTimeRequest(
  group: 'fiscal_year' | 'quarter' | 'month',
  filters: AwardSearchFilterInput,
): UpstreamRequest;
