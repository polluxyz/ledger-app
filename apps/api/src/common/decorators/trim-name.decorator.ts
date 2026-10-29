import { Transform } from 'class-transformer';

/** 名稱只修剪字串前後的空白，其他型別保留給 DTO 驗證器拒絕。 */
export function TrimName(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
}
