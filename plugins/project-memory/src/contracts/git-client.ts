export interface GitStatusEntry {
  readonly index_status: string;
  readonly worktree_status: string;
  readonly path: string;
  readonly original_path?: string;
}

export interface GitClient {
  head(repo: URL): Promise<string>;
  statusPorcelain(repo: URL): Promise<readonly GitStatusEntry[]>;
  commonGitDir(repo: URL): Promise<URL>;
  mergeBase(repo: URL, left: string, right: string): Promise<string>;
  changedPaths(repo: URL, base: string, head: string): Promise<readonly string[]>;
  objectExists(repo: URL, revision: string): Promise<boolean>;
  createDetachedWorktree(repo: URL, revision: string, destination: URL): Promise<void>;
  removeWorktree(repo: URL, destination: URL): Promise<void>;
}
