import type { TasteAdapter, TasteFileAdapter, TasteProfile, TasteState, TasteResult } from './profile.js';
export interface TasteStorage { get(): Promise<string | undefined>; set(text: string): Promise<void>; delete(): Promise<void> }
export function mockAdapter(fixture: TasteProfile | null, state?: Exclude<TasteState, 'invalid'>): TasteAdapter;
export function fileAdapter(storage?: TasteStorage): TasteFileAdapter;
export function indexedDBStorage(): TasteStorage;
export interface TasteBridgeAdapter extends TasteAdapter { importCollection(references: import('./social-references.js').SocialReferences): Promise<TasteResult> }
export function bridgeAdapter(request: (url: string, options?: RequestInit) => Promise<Response>): TasteBridgeAdapter;
