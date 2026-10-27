export interface Persistence {
  read(key: string): string | null;
  write(key: string, value: string): void;
}
