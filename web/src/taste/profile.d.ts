export type TasteScope = 'user' | 'brand' | 'project' | 'task';
export interface TasteDials {
  palette: string[];
  typography: 'Instrument Sans' | 'Archivo Black' | 'Instrument Serif' | 'IBM Plex Mono';
  framing: 'wide' | 'centered' | 'close';
  motion: number;
  /** Direction token only: does not silently trim or retime source footage. */
  pacing: number;
  transition: 'cut' | 'dissolve' | 'match';
  density: number;
  soundtrack: 'calm' | 'propulsive' | 'playful' | 'dramatic';
}
export type TasteSignal = keyof TasteDials;
export type TasteSignals = { [K in TasteSignal]: { value: TasteDials[K] | null; evidenceCount: number; confidence: number } };
export interface TasteProvenance { sourceCount: number; itemCount: number }
export interface TasteProfile {
  schema: 'fframestudio.taste-profile/1';
  revision: string;
  signals: TasteSignals;
  provenance: TasteProvenance;
}
export interface TasteApplication {
  schema: 'fframestudio.taste-application/1';
  profileRevision: string;
  scope: TasteScope;
  scopeRevisions: { user: string; brand?: string; project?: string; task?: string };
  intensity: number;
  enabledSignals: TasteSignal[];
  changedSignals: TasteSignal[];
  dials: TasteDials;
  provenance: TasteProvenance;
  timestamp: string;
}
export interface TasteScopes {
  brand?: TasteProfile;
  project?: TasteProfile;
  task?: TasteProfile;
  constraints?: Partial<TasteDials>;
}
export type TasteState = 'ready' | 'disconnected' | 'offline' | 'unauthorized' | 'invalid';
export type TasteResult = { state: 'ready'; profile: TasteProfile } | { state: Exclude<TasteState, 'ready'> };
/** HTTP implementation is server-only; a browser adapter never receives credentials. */
export interface TasteAdapter { getProfile(): Promise<TasteResult> }
export interface TasteFileAdapter extends TasteAdapter {
  importJSON(text: string): Promise<TasteResult>;
  deleteProfile(): Promise<TasteResult>;
}
export const KEYS: TasteSignal[];
export const DEFAULT_DIALS: Readonly<TasteDials>;
export function validateProfile(value: unknown): TasteProfile;
export function parseProfile(text: string): TasteProfile;
export function validateApplication(value: unknown): TasteApplication;
export function emptySignals(): TasteSignals;
export function resolveScopes(user: TasteProfile, scopes?: TasteScopes): { signals: TasteSignals; scope: TasteScope; constraints: Partial<TasteDials>; scopeRevisions: TasteApplication['scopeRevisions']; provenance: TasteProvenance };
export interface TastePreview { scopeRevisions: TasteApplication['scopeRevisions']; provenance: TasteProvenance; before: TasteDials; dials: TasteDials; changes: { signal: TasteSignal; before: unknown; after: unknown; reason: string; evidenceCount: number }[]; scope: TasteScope; enabledSignals: TasteSignal[]; intensity: number }
export function previewTaste(profile: TasteProfile, project: object, controls?: { strength?: number; enabled?: TasteSignal[]; on?: boolean; scopes?: TasteScopes }): TastePreview;
export function tasteReceipt(profile: TasteProfile, preview: TastePreview, timestamp: string): TasteApplication;
