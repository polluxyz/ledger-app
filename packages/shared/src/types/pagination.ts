/** 一頁的結果，外加渲染分頁 UI 所需的中繼資料。 */
export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  /** 符合篩選條件的總筆數（跨所有頁）。 */
  total: number;
}
