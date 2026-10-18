import type { TasteAdapter, TasteFileAdapter, TasteProfile, TasteState } from './profile.js';
export interface TasteStorage { get(): Promise<string | undefined>; set(text: string): Promise<void>; delete(): Promise<void> }
export function mockAdapter(fixture: TasteProfile | null, state?: Exclude<TasteState, 'invalid'>): TasteAdapter;
export function fileAdapter(storage?: TasteStorage): TasteFileAdapter;
export function indexedDBStorage(): TasteStorage;
export function bridgeAdapter(request: (url: string) => Promise<Response>): TasteAdapter;
