/**
 * Drive operations (PLAN §6, §7, §11): rclone wrapper, remote listing, reconcile / sync, topic folder renames,
 * MD5 duplicate check and explicit trashing. Build a `DriveContext` once and pass it to everything.
 */
export {
  type DriveContext,
  type DriveContextConfig,
  type DriveContextOptions,
  createDriveContext,
} from "./context.ts";
export { type Md5Duplicate, findDuplicatesByMd5, md5File } from "./duplicates.ts";
export {
  DRIVE_TREES,
  type RemotePathAccess,
  UnsafeRemotePathError,
  assertDistinctTrees,
  assertSafeRemotePath,
  treeOf,
} from "./guard.ts";
export {
  type KepubRegeneration,
  type MoveStep,
  type OrphanScan,
  type Plan,
  type PlanInput,
  type PlanStep,
  type RmdirStep,
  type TrashStep,
  type UploadStep,
  emptiedFolders,
  planReconcile,
} from "./plan.ts";
export {
  type Md5Entry,
  RCLONE_EXIT_DIR_NOT_FOUND,
  RCLONE_EXIT_FILE_NOT_FOUND,
  type LsjsonOptions,
  type Rclone,
  type RcloneEntry,
  RcloneError,
  type RcloneOptions,
  type RcloneRecordedOp,
  type RcloneWriteOp,
  createRclone,
  isDirNotFound,
} from "./rclone.ts";
export { type ReconcileOptions, reconcile, reconcileBooks } from "./reconcile.ts";
export { type LibraryFile, listLibraryFiles } from "./remote-index.ts";
export { type RenameTopicOptions, renameTopicFolders } from "./topics.ts";
export { type TrashBookOptions, trashBookFiles } from "./trash.ts";
export {
  PRUNE_FRACTION_MIN_FILES,
  PRUNE_MAX_FILES,
  PRUNE_MAX_FRACTION,
  type PruneAssessment,
  assessPrune,
} from "./prune-guard.ts";
