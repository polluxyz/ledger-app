/** A page of results plus the metadata needed to render pagination. */
export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  /** Total rows matching the filter, across all pages. */
  total: number;
}
