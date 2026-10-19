export type SocialReferenceProvider = 'x' | 'pinterest' | 'youtube' | 'collection';
export interface SocialReferenceItem { url: string; title?: string; creator?: string; tags?: string[] }
export interface SocialReferences {
  schema: 'fframestudio.social-references/1';
  provider: SocialReferenceProvider;
  collectionId: string;
  items: SocialReferenceItem[];
}
export const SOCIAL_REFERENCES_SCHEMA: 'fframestudio.social-references/1';
export const MAX_SOCIAL_REFERENCES_BYTES: number;
export function normalizeSocialReferences(value: unknown): SocialReferences;
export function parseSocialReferences(text: string): SocialReferences;
export function toAgentWebCollection(refs: SocialReferences): { collectionId: string; items: SocialReferenceItem[] };
