/** Proposed engine boundary, not a claim of a production implementation. */
export type Rational = Readonly<{ numerator: number; denominator: number }>;
export type AssetId = string;
export type NodeId = string;
export type OutputSpec = Readonly<{
  width: number; height: number; frameRate: Rational;
  color: { primaries: 'bt709'; transfer: 'bt709'; matrix: 'bt709'; range: 'limited' | 'full' };
}>;
export type Attachment = Readonly<{ parentClipId: NodeId; offset: Rational }>;
export type ClipNode = Readonly<{
  id: NodeId; kind: 'video'; assetId: AssetId;
  timelineStart: Rational; sourceIn: Rational; sourceOut: Rational;
  playbackRate: Rational; zIndex: number;
  transform: { x: number; y: number; width: number; height: number; rotation: number };
  audio: { enabled: boolean; gain: number };
}>;
export type TextNode = Readonly<{
  id: NodeId; kind: 'text'; attachedTo?: Attachment;
  timelineStart: Rational; duration: Rational;
  text: string; fontAssetId: AssetId; fontSize: number; color: string;
  x: number; y: number; zIndex: number;
}>;
export type AudioNode = Readonly<{
  id: NodeId; kind: 'audio'; attachedTo?: Attachment; assetId: AssetId;
  timelineStart: Rational; sourceIn: Rational; sourceOut: Rational; gain: number;
}>;
export type Transition = Readonly<{
  id: NodeId; kind: 'cross-dissolve/v1'; outgoing: NodeId; incoming: NodeId;
  start: Rational; duration: Rational; audioCurve: 'linear' | 'equal-power' | 'none';
}>;
export type RenderSnapshot = Readonly<{
  schema: 'fframestudio.render/1'; documentRevision: string; snapshotSha256: string;
  output: OutputSpec; duration: Rational;
  nodes: readonly (ClipNode | TextNode | AudioNode)[];
  transitions: readonly Transition[];
  assets: readonly { id: AssetId; sha256: string; mime: string; licenceReceiptId: string }[];
}>;
export interface AssetResolver {
  /** Local access only by default; URLs/handles never become canonical document identity. */
  acquire(id: AssetId, use: 'preview-proxy' | 'original' | 'font', signal: AbortSignal):
    Promise<{ blob: Blob; sha256: string; release(): void }>;
}
export type Diagnostic = Readonly<{
  severity: 'error' | 'warning'; code: string; nodeId?: NodeId; message: string;
}>;
export type Capabilities = Readonly<{
  engine: string; version: string; effects: readonly string[];
  seekCompletion: 'decoded-and-painted' | 'scheduled-only';
  codecs: readonly { codec: string; direction: 'encode' | 'decode'; config: object; supported: boolean }[];
  output: OutputSpec; canPreview: boolean; canExport: boolean;
  temporalAccumulation: 'native' | 'adapter' | 'unsupported';
  diagnostics: readonly Diagnostic[];
}>;
export type PaintedFrame = Readonly<{
  revision: string; requested: Rational; actualSourceTimes: Readonly<Record<NodeId, Rational>>;
  frameIndex: number; paintedAt: number;
}>;
export interface PreviewSession {
  /** Newest generation wins; abort stale work and close stale VideoFrames. */
  apply(snapshot: RenderSnapshot, signal: AbortSignal): Promise<readonly Diagnostic[]>;
  /** Contract is fulfilled only after decode AND paint, never just queue submission. */
  seek(frameIndex: number, signal: AbortSignal): Promise<PaintedFrame>;
  play(range: { startFrame: number; endFrame: number }): Promise<void>;
  pause(): Promise<PaintedFrame>;
  metrics(): { presentedFrames: number; repeatedFrames: number; missedDeadlines: number; cacheBytes: number };
  dispose(): Promise<void>;
}
export type ExportRequest = Readonly<{
  snapshot: RenderSnapshot; output: OutputSpec;
  video: { codec: 'h264'; bitrate: number }; audio: { codec: 'aac'; sampleRate: 48000; channels: 2 };
  temporalSampling?: { internalFrameRate: Rational; shutterFraction: Rational; method: 'box' };
  licenceApprovalId: string; destination: WritableStream<Uint8Array>;
}>;
export type ExportReceipt = Readonly<{
  snapshotSha256: string; engineVersion: string; outputSha256: string;
  videoFrames: number; audioSamples: number; wallMs: number;
  verification: { decoded: boolean; avOffsetFrames: number; diagnostics: readonly Diagnostic[] };
}>;
export interface RenderEngine {
  probe(output: OutputSpec): Promise<Capabilities>;
  validate(snapshot: RenderSnapshot): readonly Diagnostic[];
  openPreview(target: HTMLCanvasElement, assets: AssetResolver, signal: AbortSignal): Promise<PreviewSession>;
  export(request: ExportRequest, assets: AssetResolver,
    progress: (p: { renderedFrames: number; totalFrames: number; wallMs: number }) => void,
    signal: AbortSignal): Promise<ExportReceipt>;
}
/** Mediabunny owns analysis jobs; active preview decode belongs to one engine, never both. */
export interface MediaIO {
  probe(asset: AssetId, signal: AbortSignal): Promise<{
    duration: Rational; frameRate?: Rational; variableFrameRate: boolean;
    width?: number; height?: number; rotation?: number; audioSampleRate?: number;
  }>;
  thumbnail(asset: AssetId, time: Rational, width: number, signal: AbortSignal): Promise<ImageBitmap>;
  proxy(asset: AssetId, output: OutputSpec, sink: WritableStream<Uint8Array>, signal: AbortSignal): Promise<void>;
}
