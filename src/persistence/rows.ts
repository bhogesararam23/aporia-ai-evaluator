export type Row = Record<string, unknown>;

export function stringValue(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new Error(`Expected string column ${column}.`);
  }
  return value;
}

export function nullableStringValue(row: Row, column: string): string | null {
  const value = row[column];
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`Expected nullable string column ${column}.`);
  }
  return value;
}

export function numberValue(row: Row, column: string): number {
  const value = row[column];
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  throw new Error(`Expected numeric column ${column}.`);
}

export function booleanValue(row: Row, column: string): boolean {
  return numberValue(row, column) !== 0;
}

export function jsonValue<T>(row: Row, column: string): T {
  const text = stringValue(row, column);
  return JSON.parse(text) as T;
}

export function nullableJsonValue<T>(row: Row, column: string): T | null {
  const text = nullableStringValue(row, column);
  return text === null ? null : (JSON.parse(text) as T);
}

export function sqlBoolean(value: boolean): number {
  return value ? 1 : 0;
}
