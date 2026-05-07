export interface DbApi {
  query: (sql: string, params?: any) => Promise<any[]>;
  get: (sql: string, params?: any) => Promise<any>;
  execute: (sql: string, params?: any) => Promise<{ changes: number, lastInsertRowid: number | bigint }>;
}

export interface SysApi {
  getPath: (name: string) => Promise<string>;
}

declare global {
  interface Window {
    api: {
      db: DbApi;
      sys: SysApi;
    };
  }
}

export const db = window.api?.db;
export const sys = window.api?.sys;
