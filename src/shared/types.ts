// ============================================================================
// Nexora — Shared Type Definitions
// ============================================================================

// ─── Database Entities ───────────────────────────────────────────────────────

export interface Root {
  id: string;
  path: string;
  label: string;
  type: 'indexed' | 'watched' | 'managed';
  active: boolean;
  created_at: string;
  updated_at: string;
  last_scanned_at?: string | null;
  scan_status?: 'idle' | 'scanning' | 'completed' | 'error';
  file_count?: number;
  total_size_bytes?: number;
  last_error?: string | null;
}

export interface FileRecord {
  id: string;
  root_id: string;
  relative_path: string;
  filename: string;
  extension: string;
  mime_type: string;
  size_bytes: number;
  hash_sha256: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  capture_time: string | null;
  file_created_at: string | null;
  file_modified_at: string | null;
  has_gps: boolean;
  latitude: number | null;
  longitude: number | null;
  thumbnail_path: string | null;
  metadata_json: string | null;
  processing_status: ProcessingStatus;
  last_scanned_at: string;
  created_at: string;
  updated_at: string;
  // Extended Metadata Intelligence
  camera_make?: string | null;
  camera_model?: string | null;
  lens_model?: string | null;
  iso?: number | null;
  focal_length?: number | null;
  aperture?: number | null;
  exposure_time?: string | null;
  orientation?: number | null;
  codec?: string | null;
  frame_rate?: number | null;
  bitrate?: number | null;
  page_count?: number | null;
  word_count?: number | null;
  doc_title?: string | null;
  doc_author?: string | null;
  doc_subject?: string | null;
  audio_artist?: string | null;
  audio_album?: string | null;
  audio_title?: string | null;
  archive_entries?: number | null;
  is_missing?: boolean;
  availability_status?: 'available' | 'missing' | 'corrupt' | 'encrypted';
  extractor_version?: string | null;
  extracted_at?: string | null;
  color_profile?: string | null;
  fingerprint?: string | null;
}

export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';

export interface Person {
  id: string;
  name: string | null;
  representative_face_id: string | null;
  is_hidden: boolean;
  is_excluded: boolean;
  review_status: 'unreviewed' | 'reviewed' | 'confirmed';
  file_count: number;
  created_at: string;
  updated_at: string;
}

export interface FaceDetection {
  id: string;
  file_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  quality_score: number | null;
  embedding: Buffer | null;
  embedding_model: string | null;
  embedding_version: number | null;
  thumbnail_path: string | null;
  is_excluded: boolean;
  created_at: string;
}

export interface FaceCluster {
  id: string;
  person_id: string | null;
  centroid_embedding: Buffer | null;
  model_version: string | null;
  member_count: number;
  avg_confidence: number;
  created_at: string;
  updated_at: string;
}

export interface ClusterMember {
  cluster_id: string;
  face_detection_id: string;
  distance: number;
  added_at: string;
}

export interface VideoObservation {
  id: string;
  file_id: string;
  face_detection_id: string;
  timestamp_seconds: number;
  frame_number: number;
  created_at: string;
}

export interface FilePerson {
  file_id: string;
  person_id: string;
  association_type: 'auto' | 'manual' | 'confirmed';
  created_at: string;
}

export interface MediaTag {
  id: string;
  file_id: string;
  tag: string;
  source: 'user' | 'ai' | 'ocr';
  confidence: number | null;
  model_version: string | null;
  created_at: string;
}

export interface OcrResult {
  id: string;
  file_id: string;
  text: string;
  language: string | null;
  confidence: number | null;
  model_version: string | null;
  created_at: string;
}

export interface LocationRecord {
  id: string;
  file_id: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  place_name: string | null;
  city: string | null;
  country: string | null;
  source: 'exif' | 'user' | 'inferred';
  created_at: string;
}

export interface EventRecord {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  location_name: string | null;
  is_auto_generated: boolean;
  created_at: string;
  updated_at: string;
}

export interface EventFile {
  event_id: string;
  file_id: string;
  added_at: string;
}

export interface Collection {
  id: string;
  name: string;
  description: string | null;
  cover_file_id: string | null;
  is_smart: boolean;
  smart_query: string | null;
  created_at: string;
  updated_at: string;
}

export interface CopyOperation {
  id: string;
  type: 'person_organize' | 'timeline_organize' | 'manual_copy' | 'export';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'undone' | 'reverted';
  source_description: string;
  destination_root: string;
  total_files: number;
  completed_files: number;
  failed_files: number;
  total_bytes: number;
  copied_bytes: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface OperationItem {
  id: string;
  operation_id: string;
  source_path: string;
  destination_path: string;
  source_hash: string | null;
  destination_hash: string | null;
  status: 'pending' | 'copied' | 'verified' | 'failed' | 'undone';
  error_message: string | null;
  file_size: number;
  created_at: string;
}

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  priority: number;
  progress: number;
  total: number;
  target_path: string | null;
  target_id: string | null;
  config_json: string | null;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  stage?: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type JobType =
  | 'folder_scan'
  | 'metadata_extract'
  | 'thumbnail_generate'
  | 'face_detect'
  | 'face_embed'
  | 'face_cluster'
  | 'video_analyze'
  | 'hash_compute'
  | 'duplicate_compare'
  | 'ocr'
  | 'semantic_index'
  | 'organization_copy'
  | 'reconciliation';

export type JobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface JobError {
  id: string;
  job_id: string;
  file_path: string | null;
  error_type: string;
  error_message: string;
  is_recoverable: boolean;
  created_at: string;
}

export interface WatchRoot {
  id: string;
  path: string;
  label: string;
  active: boolean;
  auto_index: boolean;
  auto_organize: boolean;
  exclude_patterns: string;
  last_scan_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DuplicateGroup {
  id: string;
  type: 'exact' | 'similar';
  hash: string | null;
  similarity_score: number | null;
  file_count: number;
  total_size: number;
  status: 'pending' | 'reviewed' | 'resolved';
  created_at: string;
}

export interface DuplicateGroupFile {
  group_id: string;
  file_id: string;
  is_original: boolean;
}

export interface AppSetting {
  key: string;
  value: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  category: string;
  updated_at: string;
}

// ─── IPC Channel Definitions ─────────────────────────────────────────────────

export type IpcChannel =
  | 'fs:list-drives'
  | 'fs:list-directory'
  | 'fs:get-file-info'
  | 'fs:read-file-preview'
  | 'fs:open-file'
  | 'fs:reveal-in-explorer'
  | 'fs:copy-files'
  | 'fs:get-thumbnail'
  | 'db:query'
  | 'db:execute'
  | 'db:get-stats'
  | 'jobs:create'
  | 'jobs:list'
  | 'jobs:cancel'
  | 'jobs:pause'
  | 'jobs:resume'
  | 'people:list'
  | 'people:get'
  | 'people:update'
  | 'people:merge'
  | 'people:split'
  | 'people:delete'
  | 'search:query'
  | 'search:suggest'
  | 'settings:get'
  | 'settings:set'
  | 'settings:get-all'
  | 'watcher:add'
  | 'watcher:remove'
  | 'watcher:list'
  | 'watcher:toggle'
  | 'dialog:open-folder'
  | 'dialog:open-file'
  | 'dialog:save-file'
  | 'app:get-version'
  | 'app:get-paths'
  | 'system:get-hardware-metrics'
  | 'system:get-queue-stats'
  | 'system:pause-all-jobs'
  | 'system:resume-all-jobs'
  | 'llm:get-status'
  | 'llm:classify'
  | 'llm:recommend-organization'
  | 'llm:cancel';

// ─── API Request/Response Types ──────────────────────────────────────────────

export interface DriveInfo {
  letter: string;
  label: string;
  type: string;
  totalSize: number;
  freeSpace: number;
  usedSpace: number;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size: number;
  modified: string;
  created: string;
  extension: string;
  isHidden: boolean;
  isSystem: boolean;
  isReadOnly: boolean;
}

export interface DirectoryListResult {
  path: string;
  entries: DirectoryEntry[];
  totalCount: number;
  error?: string;
}

export interface FilePreview {
  path: string;
  type: 'image' | 'video' | 'text' | 'pdf' | 'unknown';
  thumbnailDataUrl?: string;
  textContent?: string;
  metadata?: Record<string, unknown>;
}

export interface DashboardStats {
  totalFiles: number;
  totalImages: number;
  totalVideos: number;
  totalPeople: number;
  reviewedPeople: number;
  unreviewedPeople: number;
  duplicateGroups: number;
  activeJobs: number;
  pendingJobs: number;
  failedJobs: number;
  totalIndexedSize: number;
  recentActivity: ActivityEntry[];
  watchedFolders: number;
}

export interface ActivityEntry {
  id: string;
  type: string;
  description: string;
  timestamp: string;
  status: string;
}

export interface SearchQuery {
  text?: string;
  filename?: string;
  extension?: string[];
  dateFrom?: string;
  dateTo?: string;
  sizeMin?: number;
  sizeMax?: number;
  personId?: string;
  eventId?: string;
  tags?: string[];
  hasOcr?: boolean;
  hasFaces?: boolean;
  isDuplicate?: boolean;
  rootId?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
  hasGps?: boolean;
  // Metadata Intelligence filters
  category?: 'all' | 'image' | 'video' | 'document' | 'audio' | 'archive' | 'text' | 'other';
  camera?: string;
  author?: string;
  artist?: string;
  isMissing?: boolean;
  availabilityStatus?: 'available' | 'missing' | 'corrupt' | 'encrypted';
}

export interface SearchResult {
  files: FileRecord[];
  totalCount: number;
  query: SearchQuery;
  executionTimeMs: number;
}

// ─── Metadata Organization Intelligence ─────────────────────────────────────

export interface OrganizationRule {
  id: string;
  name: string;
  description: string | null;
  pattern: string;
  fallback_behavior: 'use_fallbacks' | 'skip';
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrganizationProposalItem {
  id: string;
  rule_id?: string | null;
  source_file_id: string;
  source_path: string;
  proposed_destination: string;
  rule_name: string;
  status: 'proposed' | 'confirmed' | 'rejected' | 'executed';
  warnings: string[];
  metadata_snapshot: Record<string, unknown>;
  file_size: number;
  is_identical_duplicate?: boolean;
  has_collision?: boolean;
  category?: string;
  explanation?: string;
  confidence?: number;
  source_fingerprint?: string;
}

export interface OrganizationPreviewSummary {
  proposals: OrganizationProposalItem[];
  totalFiles: number;
  totalBytes: number;
  estimatedDuplicatesAvoided: number;
  destinationConflicts: number;
  warningsCount: number;
}

// ─── Navigation ──────────────────────────────────────────────────────────────

export type NavigationPage =
  | 'dashboard'
  | 'explorer'
  | 'organize'
  | 'people'
  | 'search'
  | 'timeline'
  | 'events'
  | 'duplicates'
  | 'storage'
  | 'activity'
  | 'history'
  | 'watched'
  | 'settings';

export interface NavigationItem {
  id: NavigationPage;
  label: string;
  icon: string;
  badge?: number;
}

// ─── Hardware & Adaptive Resource Management ───────────────────────────────

export type ResourceProfile = 'auto' | 'low' | 'balanced' | 'performance';

export interface HardwareMetrics {
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  usedMemoryBytes: number;
  memoryPressurePercent: number;
  cpuCores: number;
  cpuModel: string;
  cpuLoadPercent: number;
  gpuName: string | null;
  gpuVramBytes: number | null;
  accelerationProvider: 'DirectML' | 'CUDA' | 'OpenCL' | 'CPU';
  isGpuAvailable: boolean;
  primaryDiskType: 'SSD' | 'HDD' | 'Unknown';
  activeJobCount: number;
  detectedProfile: 'low' | 'balanced' | 'performance';
  activeProfile: 'low' | 'balanced' | 'performance';
  isThrottled: boolean;
  throttleReason?: string | null;
}

export interface JobQueueStats {
  activeJobs: number;
  queuedJobs: number;
  pausedJobs: number;
  failedJobs: number;
  completedJobs: number;
  pendingAiFiles: number;
  isPaused: boolean;
  isWaitingForIdle: boolean;
  processingRatePerSec: number;
}

// ─── App Settings ────────────────────────────────────────────────────────────

export interface AppSettings {
  theme: 'dark' | 'light';
  managedLibraryPath: string;
  thumbnailQuality: number;
  maxConcurrentJobs: number;
  faceDetectionConfidence: number;
  faceClusteringThreshold: number;
  videoSamplingInterval: number;
  enableOcr: boolean;
  enableSemanticSearch: boolean;
  watcherEnabled: boolean;
  watcherDebounceMs: number;
  autoOrganize: boolean;
  hashVerification: boolean;
  maxRetries: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  // Adaptive Hardware Tuning
  resourceProfile: ResourceProfile;
  enableBackgroundAi: boolean;
  runAiOnlyWhenIdle: boolean;
  maxCpuWorkers: number;
  maxDiskWorkers: number;
  maxAiWorkers: number;
  // Local LLM (Ollama)
  ollamaBaseUrl: string;
  ollamaModel: string;
  ollamaContextWindow: number;
  ollamaTemperature: number;
  ollamaTimeoutMs: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  managedLibraryPath: '',
  thumbnailQuality: 80,
  maxConcurrentJobs: 2,
  faceDetectionConfidence: 0.7,
  faceClusteringThreshold: 0.6,
  videoSamplingInterval: 5,
  enableOcr: false,
  enableSemanticSearch: false,
  watcherEnabled: true,
  watcherDebounceMs: 2000,
  autoOrganize: false,
  hashVerification: true,
  maxRetries: 3,
  logLevel: 'info',
  resourceProfile: 'auto',
  enableBackgroundAi: true,
  runAiOnlyWhenIdle: false,
  maxCpuWorkers: 2,
  maxDiskWorkers: 1,
  maxAiWorkers: 1,
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'qwen3-vl:8b',
  ollamaContextWindow: 4096,
  ollamaTemperature: 0.1,
  ollamaTimeoutMs: 90000,
};

// ─── Local LLM Definitions ───────────────────────────────────────────────────

export type LlmState =
  | 'unavailable'
  | 'model_missing'
  | 'initializing'
  | 'processing'
  | 'completed'
  | 'failed';

export interface LlmModelInfo {
  name: string;
  sizeBytes?: number;
  modifiedAt?: string;
  parameterSize?: string;
  quantization?: string;
}

export interface LlmStatus {
  state: LlmState;
  isAvailable: boolean;
  modelName: string;
  isModelReady: boolean;
  baseUrl: string;
  availableModels?: LlmModelInfo[];
  errorMessage?: string;
}

export interface LlmClassificationRequest {
  filename: string;
  extension: string;
  sizeBytes: number;
  metadata?: Record<string, unknown>;
  textExcerpt?: string;
}

export interface LlmClassificationResult {
  category: 'document' | 'image' | 'video' | 'audio' | 'archive' | 'code' | 'other';
  tags: string[];
  summary: string;
  suggestedFolder: string;
  confidence: number;
  modelUsed: string;
  latencyMs: number;
}

export interface LlmOrganizeProposalRequest {
  filename: string;
  extension: string;
  metadataSnapshot?: Record<string, unknown>;
  confirmedPerson?: string | null;
  availableRules?: string[];
}

export interface LlmOrganizeProposalResult {
  relativeFolder: string;
  reasoning: string;
  ruleName: string;
  warnings: string[];
  modelUsed: string;
  latencyMs: number;
  category?: 'document' | 'image' | 'video' | 'audio' | 'archive' | 'code' | 'other';
  confidence?: number;
}

export interface LlmQueryTranslationResult {
  searchQuery: SearchQuery;
  explanation: string;
  modelUsed: string;
  latencyMs: number;
}

